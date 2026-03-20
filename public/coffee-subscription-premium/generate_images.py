#!/usr/bin/env python3
"""
FloridaBrew Premium Coffee Landing Page Image Generator
Creates 5 high-quality conceptual images for the coffee subscription service
"""

from PIL import Image, ImageDraw, ImageFont
import os
from pathlib import Path

def create_gradient_background(width, height, colors):
    """Create a gradient background with given colors"""
    image = Image.new('RGB', (width, height))
    draw = ImageDraw.Draw(image)
    
    # Create vertical gradient
    for y in range(height):
        ratio = y / height
        r = int(colors[0][0] * (1 - ratio) + colors[1][0] * ratio)
        g = int(colors[0][1] * (1 - ratio) + colors[1][1] * ratio)
        b = int(colors[0][2] * (1 - ratio) + colors[1][2] * ratio)
        draw.line([(0, y), (width, y)], fill=(r, g, b))
    
    return image

def add_text_overlay(image, text, position, size=40, color=(255, 255, 255)):
    """Add text overlay to image"""
    draw = ImageDraw.Draw(image)
    try:
        # Try to use a nice font
        font = ImageFont.truetype("/System/Library/Fonts/Arial.ttf", size)
    except:
        # Fallback to default font
        font = ImageFont.load_default()
    
    # Add text with shadow for better visibility
    shadow_offset = 2
    draw.text((position[0] + shadow_offset, position[1] + shadow_offset), text, font=font, fill=(0, 0, 0, 128))
    draw.text(position, text, font=font, fill=color)
    
    return image

def create_hero_image():
    """Hero Image - Perfect morning coffee in Florida setting"""
    width, height = 800, 600
    
    # Florida-inspired gradient (golden brown to sunset orange)
    colors = [(139, 95, 42), (255, 140, 0)]  # Brown to orange
    image = create_gradient_background(width, height, colors)
    
    draw = ImageDraw.Draw(image)
    
    # Draw coffee mug silhouette
    mug_x, mug_y = width//2 - 60, height//2 - 40
    # Mug body
    draw.rectangle([mug_x, mug_y, mug_x + 120, mug_y + 100], fill=(101, 67, 33), outline=(80, 52, 26), width=3)
    # Handle
    draw.arc([mug_x + 110, mug_y + 20, mug_x + 140, mug_y + 70], start=270, end=90, fill=(80, 52, 26), width=4)
    
    # Steam effect
    for i in range(5):
        x = mug_x + 20 + i * 20
        y = mug_y - 20
        for j in range(15):
            steam_y = y - j * 5
            opacity = max(0, 255 - j * 15)
            if opacity > 0:
                draw.ellipse([x-2, steam_y, x+2, steam_y+8], fill=(255, 255, 255, opacity))
    
    # Palm tree silhouettes
    tree_x = 100
    draw.line([tree_x, height-50, tree_x, height-200], fill=(34, 139, 34), width=8)
    # Palm fronds
    for angle in range(0, 360, 45):
        end_x = tree_x + 40 * (1 if angle < 180 else -1)
        end_y = height-200 + 20
        draw.line([tree_x, height-200, end_x, end_y], fill=(34, 139, 34), width=4)
    
    # Sun
    sun_x, sun_y = width - 120, 80
    draw.ellipse([sun_x, sun_y, sun_x + 60, sun_y + 60], fill=(255, 223, 0))
    
    # Add FloridaBrew text
    add_text_overlay(image, "FloridaBrew", (50, 50), size=48, color=(255, 255, 255))
    add_text_overlay(image, "Premium Florida Coffee", (50, 100), size=24, color=(255, 255, 255))
    
    return image

def create_climate_adaptation_image():
    """Climate Adaptation - Coffee beans in different roasting stages"""
    width, height = 600, 400
    
    # Scientific/lab gradient (light blue to warm brown)
    colors = [(173, 216, 230), (139, 95, 42)]
    image = create_gradient_background(width, height, colors)
    
    draw = ImageDraw.Draw(image)
    
    # Draw coffee beans in different roasting stages
    bean_stages = [(120, 180, 200), (101, 67, 33), (62, 39, 35), (45, 25, 15)]  # Light to dark roast
    stage_labels = ["Green", "Light", "Medium", "Dark"]
    
    for i, (color, label) in enumerate(zip(bean_stages, stage_labels)):
        x = 80 + i * 120
        y = height // 2
        
        # Draw coffee beans
        for j in range(3):
            for k in range(3):
                bean_x = x + j * 20
                bean_y = y + k * 20 - 20
                draw.ellipse([bean_x, bean_y, bean_x + 15, bean_y + 25], fill=color, outline=(0, 0, 0), width=1)
                # Bean crack line
                draw.line([bean_x + 7, bean_y + 5, bean_x + 7, bean_y + 20], fill=(0, 0, 0), width=1)
        
        # Stage label
        add_text_overlay(image, label, (x, y + 80), size=16, color=(255, 255, 255))
    
    # Thermometer
    therm_x = width - 80
    draw.rectangle([therm_x, 50, therm_x + 20, 300], fill=(255, 255, 255), outline=(0, 0, 0), width=2)
    draw.rectangle([therm_x + 5, 280, therm_x + 15, 295], fill=(255, 0, 0))  # Mercury
    
    # Temperature marks
    for i, temp in enumerate([150, 200, 250, 300]):
        y_pos = 250 - i * 50
        draw.text((therm_x + 25, y_pos), f"{temp}°F", fill=(255, 255, 255))
    
    add_text_overlay(image, "Climate Adaptation Technology", (20, 20), size=20, color=(255, 255, 255))
    add_text_overlay(image, "Heat-Resistant Roasting Process", (20, 45), size=14, color=(255, 255, 255))
    
    return image

def create_cold_brew_image():
    """Cold Brew Setup - Perfect cold brew preparation"""
    width, height = 500, 600
    
    # Tropical blue gradient
    colors = [(135, 206, 250), (25, 25, 112)]  # Light blue to navy
    image = create_gradient_background(width, height, colors)
    
    draw = ImageDraw.Draw(image)
    
    # Glass with cold brew
    glass_x, glass_y = width//2 - 50, height//2 - 100
    glass_width, glass_height = 100, 200
    
    # Glass outline
    draw.rectangle([glass_x, glass_y, glass_x + glass_width, glass_y + glass_height], 
                  fill=(139, 95, 42), outline=(255, 255, 255), width=3)
    
    # Ice cubes
    ice_positions = [(glass_x + 10, glass_y + 20), (glass_x + 60, glass_y + 30), (glass_x + 25, glass_y + 80)]
    for ice_x, ice_y in ice_positions:
        draw.rectangle([ice_x, ice_y, ice_x + 25, ice_y + 25], 
                      fill=(240, 248, 255), outline=(255, 255, 255), width=2)
    
    # Brewing equipment (dripper)
    dripper_x = glass_x - 60
    draw.polygon([(dripper_x, glass_y - 50), (dripper_x + 50, glass_y - 50), 
                 (dripper_x + 40, glass_y - 10), (dripper_x + 10, glass_y - 10)], 
                fill=(139, 95, 42), outline=(101, 67, 33), width=2)
    
    # Coffee drops
    for i in range(3):
        drop_x = dripper_x + 20 + i * 5
        drop_y = glass_y - 5 + i * 10
        draw.ellipse([drop_x, drop_y, drop_x + 4, drop_y + 8], fill=(62, 39, 35))
    
    # Palm leaves decoration
    leaf_x, leaf_y = 50, 100
    draw.ellipse([leaf_x, leaf_y, leaf_x + 80, leaf_y + 40], fill=(34, 139, 34))
    draw.ellipse([leaf_x + 20, leaf_y - 20, leaf_x + 100, leaf_y + 20], fill=(34, 139, 34))
    
    add_text_overlay(image, "Perfect Cold Brew", (50, 50), size=24, color=(255, 255, 255))
    add_text_overlay(image, "Florida Style", (50, 80), size=18, color=(255, 255, 255))
    
    return image

def create_roasters_network_image():
    """Florida Roasters Network - Map with roaster locations"""
    width, height = 700, 500
    
    # Florida map background (ocean blue to land green)
    colors = [(25, 25, 112), (34, 139, 34)]
    image = create_gradient_background(width, height, colors)
    
    draw = ImageDraw.Draw(image)
    
    # Simplified Florida shape
    florida_outline = [
        (100, 200), (150, 180), (250, 160), (350, 140), (450, 130),
        (550, 140), (600, 160), (620, 200), (600, 250), (580, 300),
        (550, 350), (500, 380), (400, 400), (300, 420), (200, 410),
        (150, 380), (120, 340), (100, 300), (90, 250)
    ]
    draw.polygon(florida_outline, fill=(255, 218, 185), outline=(139, 95, 42), width=3)
    
    # Coffee shop locations
    locations = [
        (180, 250, "Miami"), (220, 280, "Keys"), (300, 300, "Naples"),
        (400, 200, "Tampa"), (480, 180, "Orlando"), (520, 160, "Jacksonville")
    ]
    
    for x, y, name in locations:
        # Coffee cup icon
        draw.ellipse([x-8, y-8, x+8, y+8], fill=(139, 95, 42), outline=(101, 67, 33), width=2)
        # Location label
        add_text_overlay(image, name, (x-20, y+15), size=12, color=(255, 255, 255))
    
    # Network lines connecting locations
    for i in range(len(locations)-1):
        x1, y1, _ = locations[i]
        x2, y2, _ = locations[i+1]
        draw.line([x1, y1, x2, y2], fill=(255, 140, 0), width=2)
    
    add_text_overlay(image, "Florida Roaster Network", (50, 30), size=28, color=(255, 255, 255))
    add_text_overlay(image, "Premium Local Partnerships", (50, 65), size=16, color=(255, 255, 255))
    
    return image

def create_subscription_box_image():
    """Subscription Box - Elegant FloridaBrew packaging"""
    width, height = 600, 600
    
    # Premium packaging gradient (deep brown to gold)
    colors = [(62, 39, 35), (255, 215, 0)]
    image = create_gradient_background(width, height, colors)
    
    draw = ImageDraw.Draw(image)
    
    # Main subscription box
    box_x, box_y = width//2 - 120, height//2 - 80
    box_width, box_height = 240, 160
    
    # Box shadow
    draw.rectangle([box_x + 5, box_y + 5, box_x + box_width + 5, box_y + box_height + 5], 
                  fill=(0, 0, 0, 100))
    
    # Main box
    draw.rectangle([box_x, box_y, box_x + box_width, box_y + box_height], 
                  fill=(139, 95, 42), outline=(101, 67, 33), width=3)
    
    # FloridaBrew logo area
    logo_area = [box_x + 20, box_y + 20, box_x + box_width - 20, box_y + 60]
    draw.rectangle(logo_area, fill=(255, 215, 0), outline=(139, 95, 42), width=2)
    add_text_overlay(image, "FloridaBrew", (box_x + 40, box_y + 30), size=20, color=(62, 39, 35))
    
    # Coffee bags inside box
    bag_positions = [
        (box_x + 30, box_y + 80), (box_x + 100, box_y + 80), (box_x + 170, box_y + 80)
    ]
    
    for bag_x, bag_y in bag_positions:
        # Coffee bag
        draw.rectangle([bag_x, bag_y, bag_x + 40, bag_y + 60], 
                      fill=(101, 67, 33), outline=(80, 52, 26), width=2)
        # Bag label
        draw.rectangle([bag_x + 5, bag_y + 10, bag_x + 35, bag_y + 25], fill=(255, 215, 0))
    
    # Brewing guide booklet
    guide_x, guide_y = box_x + 60, box_y + 150
    draw.rectangle([guide_x, guide_y, guide_x + 120, guide_y + 80], 
                  fill=(255, 255, 255), outline=(139, 95, 42), width=2)
    add_text_overlay(image, "Brewing Guide", (guide_x + 10, guide_y + 30), size=12, color=(62, 39, 35))
    
    # Premium ribbon
    ribbon_y = box_y - 20
    draw.rectangle([box_x + 80, ribbon_y, box_x + 160, ribbon_y + 40], 
                  fill=(255, 0, 0), outline=(200, 0, 0), width=2)
    add_text_overlay(image, "PREMIUM", (box_x + 90, ribbon_y + 10), size=14, color=(255, 255, 255))
    
    add_text_overlay(image, "FloridaBrew Subscription", (50, 50), size=24, color=(255, 255, 255))
    add_text_overlay(image, "Unbox the Florida Experience", (50, 80), size=16, color=(255, 255, 255))
    
    return image

def main():
    """Generate all 5 images for FloridaBrew landing page"""
    output_dir = Path("~/.openclaw/workspace/coffee-subscription-premium/images").expanduser()
    output_dir.mkdir(parents=True, exist_ok=True)
    
    print("🌴 Generating FloridaBrew Premium Coffee Images...")
    
    images = [
        ("hero-florida-coffee.jpg", create_hero_image),
        ("climate-coffee-process.jpg", create_climate_adaptation_image),
        ("cold-brew-florida.jpg", create_cold_brew_image),
        ("florida-roasters-network.jpg", create_roasters_network_image),
        ("premium-subscription-box.jpg", create_subscription_box_image)
    ]
    
    for filename, create_func in images:
        print(f"  Creating {filename}...")
        image = create_func()
        filepath = output_dir / filename
        image.save(filepath, "JPEG", quality=95)
        print(f"  ✅ Saved: {filepath}")
    
    print("\n🎉 All FloridaBrew images generated successfully!")
    print(f"📂 Images saved to: {output_dir}")
    
    # Create a summary file
    summary_path = output_dir / "README.md"
    with open(summary_path, 'w') as f:
        f.write("""# FloridaBrew Premium Coffee Landing Page Images

## Generated Images

1. **hero-florida-coffee.jpg** (800x600px)
   - Hero image with steaming coffee mug
   - Florida setting with palm trees and golden sunshine
   - Premium aesthetic with warm lighting

2. **climate-coffee-process.jpg** (600x400px)
   - Coffee beans in different roasting stages
   - Scientific/laboratory aesthetic
   - Heat adaptation technology visualization

3. **cold-brew-florida.jpg** (500x600px)
   - Cold brew preparation setup
   - Tropical Florida background
   - Refreshing summer vibe

4. **florida-roasters-network.jpg** (700x500px)
   - Florida map with roaster locations
   - Local coffee shops network visualization
   - Community-focused design

5. **premium-subscription-box.jpg** (600x600px)
   - Elegant FloridaBrew subscription box
   - Unboxing experience aesthetic
   - Premium packaging design

## Style
- Professional, warm, premium aesthetic
- Florida-inspired colors (golden browns, sunset oranges, ocean blues)
- High-quality product photography style

All images optimized for web use with 95% JPEG quality.
""")
    
    print(f"📋 Documentation saved: {summary_path}")

if __name__ == "__main__":
    main()