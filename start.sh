#!/bin/bash
# Start the Pure External Organization Cleaning Wizard

echo "Starting ROR Docker containers..."
docker start ror-api-elasticsearch7-1 rorapiweb 2>/dev/null || echo "  (ROR containers not found — run 'docker compose up -d' first)"

echo "Starting backend..."
cd "$(dirname "$0")/backend"
python main.py &
BACKEND_PID=$!

echo "Starting frontend..."
cd "$(dirname "$0")/frontend"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "Pure External Organization Cleaning Wizard is running:"
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://localhost:8001"
echo ""
echo "Press Ctrl+C to stop."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
