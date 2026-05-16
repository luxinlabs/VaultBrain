#!/bin/bash

# DealFlow AI - Quick Setup Script
# Run this to set up the backend in one command

set -e

echo "🚀 DealFlow AI - Quick Setup"
echo "=============================="
echo ""

# Check prerequisites
echo "📋 Checking prerequisites..."

if ! command -v bun &> /dev/null; then
    echo "❌ Bun is not installed. Install from https://bun.sh"
    exit 1
fi

if ! command -v psql &> /dev/null; then
    echo "❌ PostgreSQL is not installed. Install from https://postgresql.org"
    exit 1
fi

echo "✅ Prerequisites OK"
echo ""

# Navigate to backend
cd backend

# Install dependencies
echo "📦 Installing dependencies..."
bun install
echo "✅ Dependencies installed"
echo ""

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cp .env.example .env
    echo "✅ .env created (edit with your DATABASE_URL)"
    echo ""
fi

# Check if database exists
DB_NAME="dealflow_ai"
if psql -lqt | cut -d \| -f 1 | grep -qw $DB_NAME; then
    echo "ℹ️  Database '$DB_NAME' already exists"
else
    echo "🗄️  Creating database '$DB_NAME'..."
    createdb $DB_NAME
    echo "✅ Database created"
fi
echo ""

# Run schema
echo "📊 Setting up database schema..."
bun run db:setup
echo ""

# Seed data
echo "🌱 Seeding demo data..."
bun run db:seed
echo ""

echo "✅ Setup complete!"
echo ""
echo "📚 Next steps:"
echo "  1. Edit backend/.env with your database URL (if needed)"
echo "  2. Start the backend: cd backend && bun run dev"
echo "  3. Test health check: curl http://localhost:3001/health"
echo ""
echo "👥 Demo credentials:"
echo "  Partner: alice@dealflow.ai / partner123"
echo "  Analyst: bob@dealflow.ai / analyst123"
echo ""
echo "📖 Read NEXT_STEPS.md for demo instructions"
echo ""
echo "🎉 Ready to demo!"
