import asyncio
import os
import sys
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.join(os.path.dirname(__file__), "app"))

from app.api.videos import process_video, jobs
import urllib.request

async def main():
    job_id = "test-123"
    jobs[job_id] = {}
    
    print("Downloading a sample valid MP4...")
    video_path = "sample.mp4"
    urllib.request.urlretrieve("https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4", video_path)
    
    print("Running process_video on sample MP4...")
    await process_video(job_id, video_path)
    print(jobs[job_id])

asyncio.run(main())
