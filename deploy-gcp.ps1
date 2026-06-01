# ChatStox - Google Cloud Run Automated Deployment Script
# This script builds and deploys both the backend and frontend services to GCP.

$PROJECT_ID = "chat-stox"
$REGION = "us-central1"

# Enable color output
$Host.UI.RawUI.ForegroundColor = "White"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  CHATSTOX GCP ENTERPRISE DEPLOYER" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# 1. Set current project
Write-Host "`n[GCP] Targeting Google Cloud Project: $PROJECT_ID..." -ForegroundColor Yellow
gcloud config set project $PROJECT_ID

# 2. Deploy Backend
Write-Host "`n[GCP] Deploying BACKEND service to Cloud Run..." -ForegroundColor Yellow
cd backend

# Deploy backend using Cloud Build under the hood (zero-setup docker build on GCP)
gcloud run deploy chatstox-backend `
  --source . `
  --region $REGION `
  --allow-unauthenticated `
  --set-env-vars="POLYGON_API_KEY=YsPT9O6G9E5p52c3QRj7ddHTZjgBSFUM,GEMINI_API_KEY=AIzaSyBhEIqAvMnbGEB8FfuqscMMnVqn2SV4Ci0,GOOGLE_CLOUD_PROJECT=chat-stox"

if ($LASTEXITCODE -ne 0) {
  Write-Host "`n[Error] Backend deployment failed." -ForegroundColor Red
  cd ..
  Exit 1
}

cd ..

# 3. Retrieve Backend Live URL
Write-Host "`n[GCP] Retrieving backend production URL..." -ForegroundColor Yellow
$BACKEND_URL = (gcloud run services describe chatstox-backend --region $REGION --format="value(status.url)")

if (-not $BACKEND_URL) {
  Write-Host "[Error] Failed to resolve live backend URL." -ForegroundColor Red
  Exit 1
}
Write-Host "-> Live Backend URL: $BACKEND_URL" -ForegroundColor Green

# 4. Deploy Frontend
Write-Host "`n[GCP] Deploying FRONTEND Nginx service to Cloud Run..." -ForegroundColor Yellow

# Build the frontend passing the live backend url and polygon keys for compilation
# We specify --port=80 because our Nginx Dockerfile serves on port 80.
gcloud run deploy chatstox-frontend `
  --source . `
  --region $REGION `
  --allow-unauthenticated `
  --port=80 `
  --set-env-vars="POLYGON_API_KEY=YsPT9O6G9E5p52c3QRj7ddHTZjgBSFUM,API_URL=$BACKEND_URL"

if ($LASTEXITCODE -ne 0) {
  Write-Host "`n[Error] Frontend deployment failed." -ForegroundColor Red
  Exit 1
}

# 5. Retrieve Frontend Live URL
$FRONTEND_URL = (gcloud run services describe chatstox-frontend --region $REGION --format="value(status.url)")

Write-Host "`n==================================================" -ForegroundColor Green
Write-Host "  DEPLOYMENT SUCCESSFUL! CHATSTOX IS NOW LIVE!" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host "-> WEB PAGE (Frontend): $FRONTEND_URL" -ForegroundColor Cyan
Write-Host "-> API SERVER (Backend): $BACKEND_URL" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Green
