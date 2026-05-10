"""
Public Prompt Gallery API — serves published prompts for the SEO gallery.
"""

from fastapi import APIRouter, Query
from pydantic import BaseModel

router = APIRouter()


# Mock data — replace with Supabase queries in production
GALLERY_PROMPTS = [
    {
        "slug": "floki-barnyard-adventure",
        "title": "Floki's Barnyard Adventure",
        "category": "character",
        "tool": "Midjourney",
        "likes": 234,
        "preview": "Small golden puppy with red bandana, playful happy face, standing in green grass...",
        "full_prompt": "Small golden puppy with red bandana, playful happy face, standing in green grass beside wooden farm crates, sparkling pond far behind, white fence, blue sky, colorful flowers, warm cheerful farm lighting, Pixar-quality 3D cartoon still frame, soft rounded body, smooth polished fur.",
        "video_prompt": "Animate Floki standing near the red barn with cheerful tail wagging, tiny blinking, soft breathing, and a playful head turn toward the farm.",
    },
    {
        "slug": "cyberpunk-street-chase",
        "title": "Cyberpunk Street Chase",
        "category": "scene",
        "tool": "VEO",
        "likes": 189,
        "preview": "Neon-lit alleyway in a rain-soaked cyberpunk city, reflective wet asphalt...",
        "full_prompt": "Neon-lit alleyway in a rain-soaked cyberpunk city, reflective wet asphalt, holographic billboards flickering, steam vents glowing orange, cinematic noir atmosphere, shot on Arri Alexa, 8k.",
        "video_prompt": None,
    },
    {
        "slug": "fantasy-dragon-flight",
        "title": "Fantasy Dragon Flight",
        "category": "video",
        "tool": "Runway",
        "likes": 412,
        "preview": "Majestic emerald dragon soaring above cloud-covered mountains at golden hour...",
        "full_prompt": "Majestic emerald dragon soaring above cloud-covered mountains at golden hour, massive wingspan, scales reflecting warm sunlight, epic fantasy, 8k cinematic.",
        "video_prompt": "Smooth drone-like camera following the dragon as it banks through clouds, massive wingbeats displacing mist.",
    },
]


class GalleryPrompt(BaseModel):
    slug: str
    title: str
    category: str
    tool: str
    likes: int
    preview: str
    full_prompt: str | None = None
    video_prompt: str | None = None


class GalleryResponse(BaseModel):
    prompts: list[GalleryPrompt]
    total: int
    page: int
    per_page: int


@router.get("/", response_model=GalleryResponse)
async def get_gallery(
    category: str | None = Query(None, description="Filter by category"),
    q: str | None = Query(None, description="Search query"),
    page: int = Query(1, ge=1),
    per_page: int = Query(12, ge=1, le=50),
):
    """Get public gallery prompts with optional filtering and search."""
    filtered = GALLERY_PROMPTS

    if category and category != "all":
        filtered = [p for p in filtered if p["category"] == category]

    if q:
        q_lower = q.lower()
        filtered = [
            p for p in filtered
            if q_lower in p["title"].lower() or q_lower in p["preview"].lower()
        ]

    total = len(filtered)
    start = (page - 1) * per_page
    end = start + per_page
    page_items = filtered[start:end]

    return GalleryResponse(
        prompts=[GalleryPrompt(**p) for p in page_items],
        total=total,
        page=page,
        per_page=per_page,
    )


@router.get("/{slug}", response_model=GalleryPrompt)
async def get_prompt_by_slug(slug: str):
    """Get a single gallery prompt by slug."""
    for prompt in GALLERY_PROMPTS:
        if prompt["slug"] == slug:
            return GalleryPrompt(**prompt)
    from fastapi import HTTPException
    raise HTTPException(status_code=404, detail="Prompt not found")
