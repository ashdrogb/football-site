#!/bin/bash
# ── PITCH Football Analysis — Start Script ──────────────────
set -e

echo ""
echo "  ⚽  PITCH — Football Analysis Dashboard"
echo "  ────────────────────────────────────────"

# Check Python
if ! command -v python3 &> /dev/null; then
  echo "  ✗ Python 3 not found. Please install Python 3.10+"
  exit 1
fi

cd "$(dirname "$0")"

# Install dependencies
echo "  → Installing Python dependencies..."
pip install -r requirements.txt -q

# Launch
echo "  → Starting backend at http://localhost:8000"
echo "  → Open your browser at: http://localhost:8000"
echo "  ────────────────────────────────────────"
echo ""

cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
