import os
import time
import jwt
import requests
from pathlib import Path
import sys

# Change this to your actual Railway URL! (e.g., https://autoflow-extractor-...up.railway.app)
RAILWAY_URL = "https://autoflow-extractor-production.up.railway.app"

# The same secret key you put in Railway Variables
SECRET_KEY = "insecure-dev-key-change-me"

VIDEO_PATH = r"C:\Users\HP PROBOOK\Downloads\videos (1).mp4"

# Generate a mock token exactly like the Django backend does
token = jwt.encode({"user_id": 1, "username": "test_user"}, SECRET_KEY, algorithm="HS256")

def test_railway():
    print(f"Testing Railway API: {RAILWAY_URL}/api/videos/analyze")
    
    if "REPLACE_WITH" in RAILWAY_URL:
        print("❌ ERROR: You need to paste your Railway URL at the top of this file first!")
        sys.exit(1)

    if not os.path.exists(VIDEO_PATH):
        print("❌ ERROR: Video file not found!")
        sys.exit(1)

    headers = {"Authorization": f"Bearer {token}"}
    
    print("🚀 Uploading video to Railway...")
    with open(VIDEO_PATH, "rb") as f:
        # Safe filename for HTTP upload
        safe_filename = "test_video.mp4"
        files = {"video": (safe_filename, f, "video/mp4")}
        
        try:
            response = requests.post(f"{RAILWAY_URL}/api/videos/analyze", headers=headers, files=files)
        except Exception as e:
            print(f"❌ Connection failed: {e}")
            sys.exit(1)
            
    if response.status_code != 200:
        print(f"❌ Upload failed with status {response.status_code}: {response.text}")
        sys.exit(1)
        
    job_id = response.json()["job_id"]
    print(f"✅ Upload successful! Job ID: {job_id}")
    
    print("⏳ Waiting for Gemini to analyze (polling Railway every 5 seconds)...")
    while True:
        status_resp = requests.get(f"{RAILWAY_URL}/api/videos/status/{job_id}", headers=headers)
        if status_resp.status_code != 200:
            print(f"❌ Status check failed: {status_resp.text}")
            break
            
        data = status_resp.json()
        status = data["status"]
        step = data.get("step", "")
        
        print(f"   ➔ Status: {status} | Step: {step}")
        
        if status == "completed":
            print("\n" + "="*50)
            print("🎉 EXTRACTION SUCCESSFUL ON RAILWAY!")
            print("="*50 + "\n")
            print("🎥 VIDEO CONCEPT:")
            print(data["result"].get("video_concept"))
            break
        elif status == "failed":
            print(f"\n❌ EXTRACTION FAILED: {data.get('error')}")
            break
            
        time.sleep(5)

if __name__ == "__main__":
    # Force UTF-8 for Windows terminal emoji issues
    sys.stdout.reconfigure(encoding='utf-8')
    test_railway()
