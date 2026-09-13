import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

def create_store_assets():
    raw_dir = r"c:\Users\HP PROBOOK\Desktop\autoflow\studio-extension\store-assets\raw"
    base_dir = r"c:\Users\HP PROBOOK\Desktop\autoflow\studio-extension\store-assets"
    
    framed_dir = os.path.join(base_dir, "framed-1280x800")
    direct_dir = os.path.join(base_dir, "direct-1280x800")
    promo_dir = os.path.join(base_dir, "promo-tiles")
    
    os.makedirs(framed_dir, exist_ok=True)
    os.makedirs(direct_dir, exist_ok=True)
    os.makedirs(promo_dir, exist_ok=True)

    icon_path = r"c:\Users\HP PROBOOK\Desktop\autoflow\studio-extension\icons\icon128.png"

    img_canvas_adidas = Image.open(os.path.join(raw_dir, "Screenshot 2026-08-21 000618.png"))
    img_director_zoom = Image.open(os.path.join(raw_dir, "Screenshot 2026-08-20 000310.png"))
    img_canvas_tennis = Image.open(os.path.join(raw_dir, "Screenshot 2026-08-20 000251.png"))
    img_dragon_canvas = Image.open(os.path.join(raw_dir, "Screenshot 2026-08-21 005437.png"))
    img_gemini_builder = Image.open(os.path.join(raw_dir, "Screenshot 2026-08-21 005515.png"))
    
    icon_img = Image.open(icon_path).convert("RGBA")

    # Font definitions
    font_bold_path = r"C:\Windows\Fonts\segoeuib.ttf"
    font_reg_path = r"C:\Windows\Fonts\segoeui.ttf"
    
    font_title = ImageFont.truetype(font_bold_path, 28)
    font_subtitle = ImageFont.truetype(font_reg_path, 15)
    font_badge = ImageFont.truetype(font_bold_path, 12)
    font_win_title = ImageFont.truetype(font_reg_path, 12)

    font_promo_title = ImageFont.truetype(font_bold_path, 26)
    font_promo_sub = ImageFont.truetype(font_bold_path, 13)
    font_promo_chip = ImageFont.truetype(font_bold_path, 11)
    font_promo_bot = ImageFont.truetype(font_bold_path, 11)

    font_marquee_title = ImageFont.truetype(font_bold_path, 38)
    font_marquee_sub = ImageFont.truetype(font_reg_path, 17)
    font_marquee_badge = ImageFont.truetype(font_bold_path, 13)
    font_marquee_b_title = ImageFont.truetype(font_bold_path, 15)
    font_marquee_b_desc = ImageFont.truetype(font_reg_path, 13)

    def draw_rounded_rect(draw, bbox, radius, fill, outline=None, width=1):
        draw.rounded_rectangle(bbox, radius=radius, fill=fill, outline=outline, width=width)

    def draw_check_icon(draw, cx, cy, size, color):
        points = [
            (cx - size * 0.4, cy),
            (cx - size * 0.1, cy + size * 0.35),
            (cx + size * 0.45, cy - size * 0.35)
        ]
        draw.line([points[0], points[1]], fill=color, width=2)
        draw.line([points[1], points[2]], fill=color, width=2)

    def draw_play_icon(draw, cx, cy, size, color):
        points = [
            (cx - size * 0.3, cy - size * 0.4),
            (cx + size * 0.45, cy),
            (cx - size * 0.3, cy + size * 0.4)
        ]
        draw.polygon(points, fill=color)

    def draw_lock_icon(draw, cx, cy, size, color):
        body = [cx - size * 0.35, cy - size * 0.1, cx + size * 0.35, cy + size * 0.45]
        draw.rounded_rectangle(body, radius=2, fill=color)
        draw.arc([cx - size * 0.25, cy - size * 0.45, cx + size * 0.25, cy + size * 0.05], start=180, end=0, fill=color, width=2)

    def create_gradient_bg(width, height, top_color, bot_color, glow_points=None):
        bg = Image.new("RGBA", (width, height), top_color)
        draw = ImageDraw.Draw(bg)
        for y in range(height):
            ratio = y / height
            r = int(top_color[0] + (bot_color[0] - top_color[0]) * ratio)
            g = int(top_color[1] + (bot_color[1] - top_color[1]) * ratio)
            b = int(top_color[2] + (bot_color[2] - top_color[2]) * ratio)
            draw.line([(0, y), (width, y)], fill=(r, g, b, 255))
        
        if glow_points:
            glow_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
            g_draw = ImageDraw.Draw(glow_layer)
            for gx, gy, gr, gcolor in glow_points:
                for rad in range(gr, 0, -6):
                    alpha = int(gcolor[3] * (1 - rad / gr) * 0.5)
                    col = (gcolor[0], gcolor[1], gcolor[2], alpha)
                    g_draw.ellipse([gx - rad, gy - rad, gx + rad, gy + rad], fill=col)
            glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(30))
            bg = Image.alpha_composite(bg, glow_layer)
        
        return bg

    def create_framed_screenshot(title, subtitle, badge_text, badge_color, shot_img, window_title="AutoFlow Studio — Workflow Canvas", crop_top=32, zoom_box=None, custom_canvas_bg=None, focus_top_ratio=0.33):
        W, H = 1280, 800
        glows = [
            (240, 100, 320, (139, 92, 246, 65)),
            (1080, 420, 380, (16, 185, 129, 45)),
            (640, 760, 420, (59, 130, 246, 50))
        ]
        base = create_gradient_bg(W, H, (9, 11, 17), (5, 6, 9), glows)
        draw = ImageDraw.Draw(base)

        # Header Badge
        badge_pad_x, badge_pad_y = 12, 5
        bbox = font_badge.getbbox(badge_text)
        bw = bbox[2] - bbox[0] + badge_pad_x * 2 + 14
        bh = bbox[3] - bbox[1] + badge_pad_y * 2
        badge_x, badge_y = 60, 32

        draw_rounded_rect(draw, [badge_x, badge_y, badge_x + bw, badge_y + bh], radius=bh//2, fill=(22, 27, 40, 240), outline=badge_color, width=1)
        draw.ellipse([badge_x + 10, badge_y + bh//2 - 3, badge_x + 16, badge_y + bh//2 + 3], fill=badge_color)
        draw.text((badge_x + 22, badge_y + badge_pad_y - 1), badge_text, fill=badge_color, font=font_badge)

        # Title & Subtitle
        draw.text((60, 68), title, fill=(255, 255, 255, 255), font=font_title)
        draw.text((60, 106), subtitle, fill=(148, 163, 184, 255), font=font_subtitle)

        # Window Mockup Frame
        mockup_x = 60
        mockup_y = 145
        mockup_w = 1160
        mockup_h = 615

        # Shadow
        shadow_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        s_draw = ImageDraw.Draw(shadow_layer)
        draw_rounded_rect(s_draw, [mockup_x - 6, mockup_y - 6, mockup_x + mockup_w + 6, mockup_y + mockup_h + 6], radius=18, fill=(0, 0, 0, 200))
        shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(16))
        base = Image.alpha_composite(base, shadow_layer)
        draw = ImageDraw.Draw(base)

        # Window Frame
        draw_rounded_rect(draw, [mockup_x, mockup_y, mockup_x + mockup_w, mockup_y + mockup_h], radius=14, fill=(15, 17, 26, 255), outline=(45, 52, 75, 255), width=1)

        # Titlebar
        titlebar_h = 34
        draw_rounded_rect(draw, [mockup_x, mockup_y, mockup_x + mockup_w, mockup_y + titlebar_h], radius=14, fill=(20, 23, 34, 255))
        draw.rectangle([mockup_x, mockup_y + 14, mockup_x + mockup_w, mockup_y + titlebar_h], fill=(20, 23, 34, 255))
        draw.line([(mockup_x, mockup_y + titlebar_h), (mockup_x + mockup_w, mockup_y + titlebar_h)], fill=(38, 44, 64, 255), width=1)

        # Dots
        dots = [(mockup_x + 18, mockup_y + 17, (239, 68, 68)), (mockup_x + 36, mockup_y + 17, (245, 158, 11)), (mockup_x + 54, mockup_y + 17, (16, 185, 129))]
        for dx, dy, dcol in dots:
            draw.ellipse([dx - 5, dy - 5, dx + 5, dy + 5], fill=dcol)

        draw.text((mockup_x + 78, mockup_y + 9), window_title, fill=(148, 163, 184, 220), font=font_win_title)

        content_w = mockup_w
        content_h = mockup_h - titlebar_h

        if custom_canvas_bg is not None:
            final_content = custom_canvas_bg
        else:
            if zoom_box:
                cropped = shot_img.crop(zoom_box)
            else:
                sw, sh = shot_img.size
                cropped = shot_img.crop((0, crop_top, sw, sh))

            cw, ch = cropped.size
            scale = max(content_w / cw, content_h / ch)
            nw, nh = int(cw * scale), int(ch * scale)
            resized = cropped.resize((nw, nh), Image.Resampling.LANCZOS)
            
            left = (nw - content_w) // 2
            top = 0 if zoom_box else min(int((nh - content_h) * focus_top_ratio), nh - content_h)
            final_content = resized.crop((left, top, left + content_w, top + content_h))

        base.paste(final_content, (mockup_x, mockup_y + titlebar_h))

        # Re-draw window outer border
        draw = ImageDraw.Draw(base)
        draw_rounded_rect(draw, [mockup_x, mockup_y, mockup_x + mockup_w, mockup_y + mockup_h], radius=14, fill=None, outline=(65, 75, 105, 255), width=1)

        return base

    # ========================================================
    # 1. FRAMED SCREENSHOTS (1280 x 800)
    # ========================================================
    print("Generating framed/1-workflow-canvas.png...")
    s1 = create_framed_screenshot(
        title="Visual Node Workflows for AI Video",
        subtitle="Connect Google Veo, Grok, Claude, and Gemini on an interactive visual canvas.",
        badge_text="VISUAL WORKFLOW CANVAS",
        badge_color=(167, 139, 250, 255),
        shot_img=img_canvas_adidas,
        window_title="AutoFlow Studio — Adidas GameCourt 2 Workflow",
        crop_top=32
    )
    s1.save(os.path.join(framed_dir, "1-workflow-canvas-1280x800.png"), "PNG")
    s1.save(os.path.join(base_dir, "1-workflow-canvas-1280x800.png"), "PNG")

    # Screenshot 2: Natural Language Builder (Gemini + Side Panel)
    print("Generating framed/2-natural-language-builder.png...")
    s2 = create_framed_screenshot(
        title="Turn Plain Language Into Complete Workflows",
        subtitle="Describe what you want — Gemini, Claude, or ChatGPT assembles the entire node pipeline in seconds.",
        badge_text="NATURAL LANGUAGE BUILDER",
        badge_color=(96, 165, 250, 255),
        shot_img=img_gemini_builder,
        window_title="AutoFlow Studio — Natural Language Workflow Builder (Gemini + Side Panel)",
        crop_top=0,
        focus_top_ratio=0.1
    )
    s2.save(os.path.join(framed_dir, "2-natural-language-builder-1280x800.png"), "PNG")
    s2.save(os.path.join(base_dir, "2-natural-language-builder-1280x800.png"), "PNG")

    # Screenshot 3: AI Story Director & Continuity (Baby Dragon Reel)
    print("Generating framed/3-story-director-dragon.png...")
    s3 = create_framed_screenshot(
        title="Lock Characters, Wardrobe & Style Across Every Shot",
        subtitle="Maintain perfect visual consistency across multi-beat video sequences automatically.",
        badge_text="AI STORY DIRECTOR & CONTINUITY",
        badge_color=(52, 211, 153, 255),
        shot_img=img_dragon_canvas,
        window_title="AutoFlow Studio — Self-Directing Viral Baby Dragon Reel",
        crop_top=32
    )
    s3.save(os.path.join(framed_dir, "3-story-director-continuity-1280x800.png"), "PNG")
    s3.save(os.path.join(base_dir, "3-story-director-continuity-1280x800.png"), "PNG")

    # Screenshot 4: Multi-Shot Video Pipeline (Tennis Shoe Ad)
    print("Generating framed/4-multishot-pipeline.png...")
    s4 = create_framed_screenshot(
        title="End-to-End Multi-Shot Video Pipeline",
        subtitle="From reference photo to finished video ads — automate complex generative pipelines in one click.",
        badge_text="MULTI-SHOT PIPELINES",
        badge_color=(244, 114, 182, 255),
        shot_img=img_canvas_tennis,
        window_title="AutoFlow Studio — Tennis Shoe Unboxing to Action Ad",
        crop_top=32
    )
    s4.save(os.path.join(framed_dir, "4-multishot-pipeline-1280x800.png"), "PNG")
    s4.save(os.path.join(base_dir, "4-multishot-pipeline-1280x800.png"), "PNG")

    # Screenshot 5: Multi-Model AI Orchestration
    print("Generating framed/5-multimodel-orchestration.png...")
    sw_c, sh_c = img_canvas_adidas.size
    s5 = create_framed_screenshot(
        title="Multi-Model AI Orchestration Without API Keys",
        subtitle="Drives your favorite AI models in your browser using your existing signed-in accounts.",
        badge_text="MULTI-MODEL AUTOMATION",
        badge_color=(251, 191, 36, 255),
        shot_img=img_canvas_adidas,
        window_title="AutoFlow Studio — Model Selector & AI Nodes",
        crop_top=32,
        zoom_box=(0, 32, int(sw_c * 0.75), int(sh_c * 0.96))
    )
    s5.save(os.path.join(framed_dir, "5-multimodel-orchestration-1280x800.png"), "PNG")
    s5.save(os.path.join(base_dir, "5-multimodel-orchestration-1280x800.png"), "PNG")

    # ========================================================
    # 2. DIRECT FULLSCREEN SCREENSHOTS (1280 x 800)
    # ========================================================
    print("Generating direct fullscreen screenshots...")
    # Direct 1: Adidas Canvas
    clean_a = img_canvas_adidas.crop((0, 32, img_canvas_adidas.width, img_canvas_adidas.height))
    scale_a = max(1280 / clean_a.width, 800 / clean_a.height)
    nwa, nha = int(clean_a.width * scale_a), int(clean_a.height * scale_a)
    d1 = clean_a.resize((nwa, nha), Image.Resampling.LANCZOS).crop(((nwa-1280)//2, (nha-800)//2, (nwa-1280)//2+1280, (nha-800)//2+800))
    d1.save(os.path.join(direct_dir, "1-direct-adidas-workflow-1280x800.png"), "PNG")

    # Direct 2: Gemini Builder Side Panel
    clean_gb = img_gemini_builder
    scale_gb = max(1280 / clean_gb.width, 800 / clean_gb.height)
    nwgb, nhgb = int(clean_gb.width * scale_gb), int(clean_gb.height * scale_gb)
    d2 = clean_gb.resize((nwgb, nhgb), Image.Resampling.LANCZOS).crop(((nwgb-1280)//2, (nhgb-800)//2, (nwgb-1280)//2+1280, (nhgb-800)//2+800))
    d2.save(os.path.join(direct_dir, "2-direct-gemini-builder-1280x800.png"), "PNG")

    # Direct 3: Baby Dragon Story Canvas
    clean_dg = img_dragon_canvas.crop((0, 32, img_dragon_canvas.width, img_dragon_canvas.height))
    scale_dg = max(1280 / clean_dg.width, 800 / clean_dg.height)
    nwdg, nhdg = int(clean_dg.width * scale_dg), int(clean_dg.height * scale_dg)
    d3 = clean_dg.resize((nwdg, nhdg), Image.Resampling.LANCZOS).crop(((nwdg-1280)//2, (nhdg-800)//2, (nwdg-1280)//2+1280, (nhdg-800)//2+800))
    d3.save(os.path.join(direct_dir, "3-direct-baby-dragon-story-1280x800.png"), "PNG")

    # Direct 4: Tennis Pipeline
    clean_t = img_canvas_tennis.crop((0, 32, img_canvas_tennis.width, img_canvas_tennis.height))
    scale_t = max(1280 / clean_t.width, 800 / clean_t.height)
    nwt, nht = int(clean_t.width * scale_t), int(clean_t.height * scale_t)
    d4 = clean_t.resize((nwt, nht), Image.Resampling.LANCZOS).crop(((nwt-1280)//2, (nht-800)//2, (nwt-1280)//2+1280, (nht-800)//2+800))
    d4.save(os.path.join(direct_dir, "4-direct-tennis-workflow-1280x800.png"), "PNG")

    # ========================================================
    # 3. PROMO TILES (Small 440x280 & Marquee 1400x560)
    # ========================================================
    print("Generating promo-tiles/promo-small-440x280.png...")
    PW, PH = 440, 280
    p_glows = [
        (80, 50, 180, (139, 92, 246, 95)),
        (380, 220, 200, (16, 185, 129, 75))
    ]
    promo = create_gradient_bg(PW, PH, (14, 16, 25), (7, 8, 13), p_glows)
    
    # Background canvas art
    bg_p = img_dragon_canvas.crop((200, 100, 1400, 850)).resize((PW, PH), Image.Resampling.LANCZOS).convert("RGBA")
    dark_overlay = Image.new("RGBA", (PW, PH), (10, 12, 18, 220))
    bg_p = Image.alpha_composite(bg_p, dark_overlay)
    promo = Image.alpha_composite(promo, bg_p)
    p_draw = ImageDraw.Draw(promo)

    # Icon
    icon_p = icon_img.resize((50, 50), Image.Resampling.LANCZOS)
    draw_rounded_rect(p_draw, [22, 20, 76, 74], radius=12, fill=(0, 0, 0, 180), outline=(55, 65, 95, 200), width=1)
    promo.paste(icon_p, (24, 22), icon_p)

    # Title & Subtitle
    p_draw.text((86, 22), "AutoFlow Studio", fill=(255, 255, 255, 255), font=font_promo_title)
    p_draw.text((88, 54), "Node Workflows for AI Video", fill=(167, 139, 250, 255), font=font_promo_sub)

    # Divider
    p_draw.line([(22, 88), (418, 88)], fill=(45, 52, 75, 220), width=1)

    # 2 rows of chips
    row1 = ["Google Veo", "Grok", "Gemini"]
    row2 = ["Claude", "ChatGPT", "Story Director"]

    def draw_chip_row(items, y_pos):
        widths = []
        for item in items:
            bbox = font_promo_chip.getbbox(item)
            widths.append(bbox[2] - bbox[0] + 18)
        total_w = sum(widths) + (len(items) - 1) * 8
        start_x = (PW - total_w) // 2
        for item, w in zip(items, widths):
            draw_rounded_rect(p_draw, [start_x, y_pos, start_x + w, y_pos + 25], radius=12, fill=(22, 26, 38, 230), outline=(59, 130, 246, 180), width=1)
            p_draw.text((start_x + 9, y_pos + 5), item, fill=(226, 232, 240, 255), font=font_promo_chip)
            start_x += w + 8

    draw_chip_row(row1, 102)
    draw_chip_row(row2, 135)

    # Value prop banner
    draw_rounded_rect(p_draw, [20, 218, 420, 258], radius=8, fill=(16, 185, 129, 30), outline=(16, 185, 129, 130), width=1)
    draw_check_icon(p_draw, 38, 238, 12, (52, 211, 153, 255))
    p_draw.text((52, 230), "No API Keys Required  ·  100% Private & Local", fill=(52, 211, 153, 255), font=font_promo_bot)

    draw_rounded_rect(p_draw, [0, 0, PW - 1, PH - 1], radius=0, fill=None, outline=(55, 65, 90, 255), width=1)
    promo.save(os.path.join(promo_dir, "promo-small-440x280.png"), "PNG")
    promo.save(os.path.join(base_dir, "promo-small-440x280.png"), "PNG")

    # Marquee Promo Banner (1400 x 560)
    print("Generating promo-tiles/marquee-large-1400x560.png...")
    MW, MH = 1400, 560
    m_glows = [
        (250, 180, 360, (139, 92, 246, 85)),
        (1120, 280, 460, (16, 185, 129, 70)),
        (700, 510, 320, (59, 130, 246, 55))
    ]
    marquee = create_gradient_bg(MW, MH, (10, 12, 18), (5, 6, 10), m_glows)
    m_draw = ImageDraw.Draw(marquee)

    # Badge
    mb_text = "NEXT-GEN AI VIDEO CREATION"
    mbbox = font_marquee_badge.getbbox(mb_text)
    mbw = mbbox[2] - mbbox[0] + 24 + 14
    mbh = mbbox[3] - mbbox[1] + 12
    draw_rounded_rect(m_draw, [70, 48, 70 + mbw, 48 + mbh], radius=mbh//2, fill=(26, 31, 46, 230), outline=(139, 92, 246, 255), width=1)
    m_draw.ellipse([82, 48 + mbh//2 - 3, 88, 48 + mbh//2 + 3], fill=(167, 139, 250, 255))
    m_draw.text((94, 53), mb_text, fill=(167, 139, 250, 255), font=font_marquee_badge)

    # Icon + Title
    icon_m = icon_img.resize((66, 66), Image.Resampling.LANCZOS)
    marquee.paste(icon_m, (70, 105), icon_m)
    m_draw.text((148, 108), "AutoFlow Studio", fill=(255, 255, 255, 255), font=font_marquee_title)
    m_draw.text((150, 152), "Visual Node Workflows for AI Video", fill=(167, 139, 250, 255), font=font_marquee_sub)

    # Bullets
    bullets = [
        ("play", "Automate Multi-Shot Videos", "Chain prompts, reference images, and video clips seamlessly."),
        ("check", "AI Story Director & Continuity", "Maintains character identity, wardrobe, and camera angles."),
        ("lock", "Zero API Keys Required", "Runs right in your browser with your existing accounts.")
    ]
    by = 212
    for b_type, b_title, b_desc in bullets:
        draw_rounded_rect(m_draw, [70, by, 580, by + 68], radius=10, fill=(18, 21, 32, 200), outline=(42, 50, 72, 220), width=1)
        draw_rounded_rect(m_draw, [84, by + 16, 120, by + 52], radius=6, fill=(28, 34, 50, 255))
        if b_type == "play":
            draw_play_icon(m_draw, 102, by + 34, 16, (167, 139, 250, 255))
        elif b_type == "check":
            draw_check_icon(m_draw, 102, by + 34, 16, (52, 211, 153, 255))
        elif b_type == "lock":
            draw_lock_icon(m_draw, 102, by + 34, 16, (96, 165, 250, 255))

        m_draw.text((132, by + 14), b_title, fill=(255, 255, 255, 255), font=font_marquee_b_title)
        m_draw.text((132, by + 38), b_desc, fill=(148, 163, 184, 255), font=font_marquee_b_desc)
        by += 78

    # Supported model tags
    m_draw.text((70, 468), "DRIVES:", fill=(100, 116, 139, 255), font=ImageFont.truetype(font_bold_path, 13))
    tag_x = 135
    model_tags = ["Google Veo", "Grok", "Gemini", "Claude", "ChatGPT"]
    font_mtag = ImageFont.truetype(font_bold_path, 12)
    for mtag in model_tags:
        mt_bbox = font_mtag.getbbox(mtag)
        mtw = mt_bbox[2] - mt_bbox[0] + 16
        draw_rounded_rect(m_draw, [tag_x, 463, tag_x + mtw, 491], radius=6, fill=(24, 29, 44, 220), outline=(59, 130, 246, 160), width=1)
        m_draw.text((tag_x + 8, 469), mtag, fill=(226, 232, 240, 255), font=font_mtag)
        tag_x += mtw + 8

    # Right Column Frame
    rw, rh = 720, 450
    rx, ry = 620, 55

    m_shadow = Image.new("RGBA", (MW, MH), (0, 0, 0, 0))
    ms_draw = ImageDraw.Draw(m_shadow)
    draw_rounded_rect(ms_draw, [rx - 6, ry - 6, rx + rw + 6, ry + rh + 6], radius=18, fill=(0, 0, 0, 210))
    m_shadow = m_shadow.filter(ImageFilter.GaussianBlur(16))
    marquee = Image.alpha_composite(marquee, m_shadow)
    m_draw = ImageDraw.Draw(marquee)

    draw_rounded_rect(m_draw, [rx, ry, rx + rw, ry + rh], radius=14, fill=(15, 17, 26, 255), outline=(55, 65, 95, 255), width=1)
    
    draw_rounded_rect(m_draw, [rx, ry, rx + rw, ry + 28], radius=14, fill=(22, 25, 38, 255))
    m_draw.rectangle([rx, ry + 12, rx + rw, ry + 28], fill=(22, 25, 38, 255))
    m_dots = [(rx + 16, ry + 14, (239, 68, 68)), (rx + 30, ry + 14, (245, 158, 11)), (rx + 44, ry + 14, (16, 185, 129))]
    for dx, dy, dcol in m_dots:
        m_draw.ellipse([dx - 4, dy - 4, dx + 4, dy + 4], fill=dcol)

    cw_m = rw
    ch_m = rh - 28
    shot_crop = img_dragon_canvas.crop((0, 32, img_dragon_canvas.width, img_dragon_canvas.height))
    scale_m = max(cw_m / shot_crop.width, ch_m / shot_crop.height)
    nwm, nhm = int(shot_crop.width * scale_m), int(shot_crop.height * scale_m)
    shot_m = shot_crop.resize((nwm, nhm), Image.Resampling.LANCZOS)
    shot_m = shot_m.crop((0, 0, cw_m, ch_m))
    marquee.paste(shot_m, (rx, ry + 28))

    m_draw = ImageDraw.Draw(marquee)
    draw_rounded_rect(m_draw, [rx, ry, rx + rw, ry + rh], radius=14, fill=None, outline=(70, 80, 115, 255), width=1)
    draw_rounded_rect(m_draw, [0, 0, MW - 1, MH - 1], radius=0, fill=None, outline=(50, 60, 85, 255), width=1)

    marquee.save(os.path.join(promo_dir, "marquee-large-1400x560.png"), "PNG")
    marquee.save(os.path.join(base_dir, "marquee-large-1400x560.png"), "PNG")

    print("\nAll assets generated successfully!")

if __name__ == "__main__":
    create_store_assets()
