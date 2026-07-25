import asyncio
import os
import sys
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.join(os.path.dirname(__file__), "app"))

from app.api.videos import process_video_url, jobs

async def main():
    job_id = "test-123"
    jobs[job_id] = {}
    print("Testing with short video...")
    await process_video_url(job_id, "https://www.youtube.com/watch?v=ba_TVrLELGw") # Some short 10s video
    print(jobs[job_id])

asyncio.run(main())
