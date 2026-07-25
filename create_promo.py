import os
from PIL import Image, ImageDraw, ImageFont

def create_gradient_bg(width, height, color1, color2):
    base = Image.new('RGB', (width, height), color1)
    top = Image.new('RGB', (width, height), color2)
    mask = Image.new('L', (width, height))
    mask_data = []
    for y in range(height):
        # vertical gradient
        mask_data.extend([int(255 * (y / height))] * width)
    mask.putdata(mask_data)
    base.paste(top, (0, 0), mask)
    return base

def draw_text_center(draw, text, font, fill, img_w, img_h, offset_y=0):
    bbox = draw.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    x = (img_w - w) / 2
    y = (img_h - h) / 2 + offset_y
    draw.text((x, y), text, font=font, fill=fill)

def generate_tile(filename, width, height):
    # Dark modern background
    bg = create_gradient_bg(width, height, (15, 19, 32), (30, 36, 50))
    draw = ImageDraw.Draw(bg)
    
    # Try Segoe UI (standard on Windows) or fallback to default
    try:
        title_font = ImageFont.truetype("segoeuib.ttf", int(height * 0.25))
        sub_font = ImageFont.truetype("segoeui.ttf", int(height * 0.08))
    except:
        title_font = ImageFont.load_default()
        sub_font = ImageFont.load_default()

    # Draw title
    draw_text_center(draw, "AutoFlow", title_font, (249, 115, 22), width, height, offset_y=-int(height * 0.1))
    
    # Draw subtitle
    draw_text_center(draw, "Video Task Manager for Google Flow", sub_font, (148, 163, 184), width, height, offset_y=int(height * 0.15))
    
    # Add a colorful accent line at the bottom
    draw.rectangle([(0, height - int(height * 0.02)), (width, height)], fill=(225, 29, 72))

    bg.save(filename, "JPEG", quality=95)
    print(f"Created {filename} ({width}x{height})")

# 1. Small promo tile (440x280)
generate_tile("small_promo_tile.jpg", 440, 280)

# 2. Marquee promo tile (1400x560)
generate_tile("marquee_promo_tile.jpg", 1400, 560)
