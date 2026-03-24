"""ROR API client — handles matching against local Docker or public ROR API."""

from typing import Optional

import httpx


class RorClient:
    """Async client for the ROR API (local Docker or public)."""

    def __init__(self, base_url: str = "http://localhost:9292"):
        self.base_url = base_url.rstrip("/")
        self._client: Optional[httpx.AsyncClient] = None

    async def __aenter__(self):
        self._client = httpx.AsyncClient(timeout=15)
        return self

    async def __aexit__(self, *args):
        if self._client:
            await self._client.aclose()

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=15)
        return self._client

    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None

    async def match(self, name: str, limit: int = 10) -> list[dict]:
        """Match an organization name against ROR affiliation endpoint.

        Handles both v1 (local Docker) and v2 (public API) response formats.
        """
        resp = await self.client.get(
            f"{self.base_url}/organizations",
            params={"affiliation": name},
        )
        resp.raise_for_status()
        data = resp.json()

        items = data.get("items", [])
        candidates = []

        for item in items[:limit]:
            org = item.get("organization", {})
            ror_id = org.get("id", "")
            candidate = {
                "ror_id": ror_id,
                "ror_name": org.get("name", ""),
                "score": item.get("score", 0),
                "matching_type": item.get("matching_type", ""),
                "chosen": 1 if item.get("chosen", False) else 0,
                "substring": item.get("substring", ""),
                "country": None,
                "country_code": None,
                "city": None,
                "aliases": org.get("aliases", []),
                "labels": [],
                "types": org.get("types", []),
            }

            # Extract location from v1 format (local Docker)
            # v1 has: organization.country.country_name, organization.addresses[].city
            country_obj = org.get("country", {})
            if isinstance(country_obj, dict):
                candidate["country"] = country_obj.get("country_name")
                candidate["country_code"] = country_obj.get("country_code")

            addresses = org.get("addresses", [])
            if addresses:
                addr = addresses[0]
                candidate["city"] = addr.get("city")
                # Also get from geonames if available
                geo_city = addr.get("geonames_city", {})
                if geo_city and not candidate["city"]:
                    candidate["city"] = geo_city.get("city")

            # Extract labels from v1 format
            v1_labels = org.get("labels", [])
            if v1_labels:
                candidate["labels"] = [
                    lbl.get("label", "") for lbl in v1_labels if lbl.get("label")
                ]

            # If v1 data didn't have location, try v2 enrichment (public API has v2)
            if not candidate["country"]:
                try:
                    ror_id_short = ror_id.replace("https://ror.org/", "")
                    v2_resp = await self.client.get(
                        f"{self.base_url}/v2/organizations/{ror_id_short}",
                    )
                    if v2_resp.status_code == 200:
                        v2_data = v2_resp.json()
                        locations = v2_data.get("locations", [])
                        if locations:
                            geo = locations[0].get("geonames_details", {})
                            candidate["country"] = geo.get("country_name")
                            candidate["country_code"] = geo.get("country_code")
                            candidate["city"] = geo.get("name")

                        names = v2_data.get("names", [])
                        v2_aliases = [
                            n.get("value", "")
                            for n in names
                            if "alias" in (n.get("types") or [])
                        ]
                        if v2_aliases:
                            candidate["aliases"] = v2_aliases
                        v2_labels = [
                            n.get("value", "")
                            for n in names
                            if "label" in (n.get("types") or [])
                        ]
                        if v2_labels:
                            candidate["labels"] = v2_labels
                except Exception:
                    pass

            candidates.append(candidate)

        # Sort: chosen first, then by score descending
        candidates.sort(key=lambda c: (-c["chosen"], -c["score"]))
        return candidates

    async def is_available(self) -> bool:
        """Check if the ROR API is reachable."""
        try:
            resp = await self.client.get(
                f"{self.base_url}/organizations",
                params={"affiliation": "test"},
            )
            return resp.status_code == 200
        except Exception:
            return False
