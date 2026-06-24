#!/bin/bash
# setup.sh — Deploy N8N to Fly.io at angafsar.fly.dev
set -e

echo "🪰 N8N → Fly.io Deployment"
echo "=============================="
echo ""

# Check flyctl
if ! command -v flyctl &>/dev/null; then
  echo "❌ flyctl not found. Install: brew install flyctl"
  exit 1
fi

# Check auth
if ! flyctl auth whoami &>/dev/null; then
  echo "🔐 Please log in to Fly.io (browser will open)..."
  flyctl auth login
fi

echo ""
echo "✅ Authenticated as: $(flyctl auth whoami)"
echo ""

# Create app if it doesn't exist
if ! flyctl apps list | grep -q "angafsar"; then
  echo "📦 Creating app: angafsar..."
  flyctl apps create angafsar --org personal
else
  echo "📦 App 'angafsar' already exists."
fi

# Create volume for persistent data (10GB)
if ! flyctl volumes list -a angafsar 2>/dev/null | grep -q "n8n_data"; then
  echo "💾 Creating persistent volume (10 GB)..."
  flyctl volumes create n8n_data --region iad --size 10 -a angafsar
else
  echo "💾 Volume 'n8n_data' already exists."
fi

# Set secrets
echo "🔑 Setting secrets..."
# Generate encryption key if not set
if ! flyctl secrets list -a angafsar 2>/dev/null | grep -q "N8N_ENCRYPTION_KEY"; then
  ENCRYPTION_KEY=$(openssl rand -hex 32)
  flyctl secrets set "N8N_ENCRYPTION_KEY=${ENCRYPTION_KEY}" -a angafsar
  echo "   N8N_ENCRYPTION_KEY: set"
else
  echo "   N8N_ENCRYPTION_KEY: already set"
fi

# Set user management JWT secret
if ! flyctl secrets list -a angafsar 2>/dev/null | grep -q "N8N_USER_MANAGEMENT_JWT_SECRET"; then
  JWT_SECRET=$(openssl rand -hex 32)
  flyctl secrets set "N8N_USER_MANAGEMENT_JWT_SECRET=${JWT_SECRET}" -a angafsar
  echo "   N8N_USER_MANAGEMENT_JWT_SECRET: set"
else
  echo "   N8N_USER_MANAGEMENT_JWT_SECRET: already set"
fi

echo ""
echo "🚀 Deploying N8N..."
flyctl deploy -a angafsar --config fly/fly.toml

echo ""
echo "=============================="
echo "✅ Deployment complete!"
echo ""
echo "🌐 Your N8N is at: https://angafsar.fly.dev"
echo ""
echo "📋 Next steps:"
echo "   1. Open https://angafsar.fly.dev"
echo "   2. Create your owner account (first-time setup)"
echo "   3. Set up Gmail OAuth2 credentials in N8N"
echo "   4. Import your workflows"
echo "   5. Run WF-4 Initial Cleanup"
echo ""
echo "⚠️  IMPORTANT: Add a credit card to Fly.io to prevent"
echo "   your free allowance from being exhausted."
echo "   https://fly.io/dashboard"
