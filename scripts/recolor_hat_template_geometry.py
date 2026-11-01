from __future__ import annotations

"""Create color-only variants on the approved black desktop/mobile photo masters.

Uses Pillow. Original appearance-reference photographs remain in place; generated
assets are written to public/images/hat_templates/geometry-locked/.
"""
from colorsys import rgb_to_hsv, hsv_to_rgb
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter
import math

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT / "public/images/hat_templates"
OUTPUT = TEMPLATES / "geometry-locked"
COLORS = ("white", "red", "blue", "green", "yellow", "neon-yellow", "orange", "pink", "purple")

def _polygon_mask(size: tuple[int, int], mobile: bool) -> Image.Image:
    width, height = size
    scale = 3
    mask = Image.new("L", (width * scale, height * scale), 0)
    draw = ImageDraw.Draw(mask)
    def polygon(points: list[tuple[int, int]], fill: int) -> None:
        draw.polygon([(x * scale, y * scale) for x, y in points], fill=fill)
    if mobile:
        outer = [(0,800),(0,645),(0,535),(8,490),(26,450),(62,360),(116,280),(182,218),(260,166),(345,129),(430,108),(500,96),(540,94),(580,96),(650,108),(735,129),(820,166),(898,218),(964,280),(1018,360),(1054,450),(1072,490),(1080,535),(1080,645),(1080,800),(1025,808),(960,806),(900,800),(876,774),(866,690),(850,625),(820,568),(782,522),(738,485),(690,455),(640,435),(590,422),(540,417),(490,422),(440,435),(390,455),(342,485),(298,522),(260,568),(230,625),(214,690),(204,774),(180,800),(120,806),(55,808)]
        opening = [(240,660),(252,610),(274,568),(309,530),(349,495),(394,468),(444,445),(492,440),(520,438),(560,438),(600,440),(650,445),(700,468),(745,495),(785,530),(820,568),(830,610),(840,660),(870,802),(205,802)]
        polygon(outer, 255)
        # Extend over the dark edge stitching; the luminance gate below keeps
        # the surrounding bright background unchanged.
        mask = mask.filter(ImageFilter.MaxFilter(31))
        draw = ImageDraw.Draw(mask)
        polygon(opening, 0)
        draw.ellipse((474*scale, 42*scale, 610*scale, 104*scale), fill=255)
    else:
        outer = [(354,485),(350,405),(350,310),(362,235),(390,170),(440,115),(500,75),(575,48),(650,32),(720,25),(790,32),(870,52),(945,90),(1005,140),(1050,205),(1078,280),(1090,360),(1090,483),(1045,490),(990,486),(950,480),(930,460),(925,405),(912,355),(890,320),(860,290),(820,268),(780,250),(740,240),(720,237),(690,239),(650,247),(610,263),(575,285),(548,312),(530,344),(520,378),(516,420),(512,478),(470,486),(420,490),(380,490)]
        opening = [(538,392),(542,360),(557,330),(582,300),(612,276),(647,270),(687,260),(720,257),(753,260),(793,270),(828,292),(858,316),(883,346),(898,377),(904,392),(922,486),(510,486)]
        polygon(outer, 255)
        mask = mask.filter(ImageFilter.MaxFilter(31))
        draw = ImageDraw.Draw(mask)
        polygon(opening, 0)
        draw.ellipse((680*scale, 12*scale, 766*scale, 42*scale), fill=255)
    return mask.resize(size, Image.Resampling.LANCZOS)

def _quantile(values: list[int], fraction: float) -> int:
    if not values:
        raise ValueError("No fabric pixels found for recoloring")
    values.sort()
    return values[min(len(values)-1, int((len(values)-1) * fraction))]

def _piecewise_lut(source: tuple[int, int, int], target: tuple[int, int, int]) -> list[int]:
    points = [(0, 0), *zip(source, target), (255, 255)]
    result: list[int] = []
    for value in range(256):
        for index in range(1, len(points)):
            x0, y0 = points[index-1]
            x1, y1 = points[index]
            if value <= x1:
                amount = 0 if x1 == x0 else (value - x0) / (x1 - x0)
                result.append(max(0, min(255, round(y0 + amount * (y1-y0)))))
                break
    return result

def _reference_palette(path: Path, crop_box: tuple[int, int, int, int]) -> tuple[float, float, tuple[int, int, int]]:
    image = Image.open(path).convert("RGB").crop(crop_box)
    image.thumbnail((220, 220))
    hues: list[float] = []
    saturations: list[float] = []
    values: list[int] = []
    for red, green, blue in image.get_flattened_data():
        hue, saturation, value = rgb_to_hsv(red/255, green/255, blue/255)
        if saturation >= .30 and value >= .08:
            hues.append(hue)
            saturations.append(saturation)
            values.append(round(value * 255))
    if not hues:
        raise ValueError(f"No colored fabric reference pixels in {path}")
    hue = math.atan2(sum(math.sin(h*2*math.pi) for h in hues), sum(math.cos(h*2*math.pi) for h in hues)) / (2*math.pi) % 1
    saturations.sort()
    return hue, saturations[len(saturations)//2], tuple(_quantile(values, q) for q in (.10, .50, .90))

def generate_format(mobile: bool) -> None:
    suffix = "-mobile" if mobile else ""
    master = Image.open(TEMPLATES / f"hat-black{suffix}.png").convert("RGB")
    width, height = master.size
    luma = master.convert("L")
    cap = _polygon_mask(master.size, mobile)
    # The black-master mesh openings are bright; limit the mask to dark fabric
    # strands and let anti-aliased silhouette edges fade naturally.
    gate = luma.point([255 if value <= 105 else max(0, min(255, round(255*(145-value)/40))) for value in range(256)])
    alpha = ImageChops.multiply(cap, gate)
    fabric_luma = [value for (value, inside) in zip(luma.get_flattened_data(), cap.get_flattened_data()) if inside > 240 and value <= 145]
    source_levels = tuple(_quantile(fabric_luma.copy(), q) for q in (.10, .50, .90))

    for color in COLORS:
        ref_path = TEMPLATES / f"hat-{color}{suffix}.png"
        if color == "white":
            box = (520, 30, 920, 240) if not mobile else (270, 90, 810, 420)
            reference = Image.open(ref_path).convert("RGB").crop(box).convert("L")
            target_levels = tuple(_quantile(list(reference.get_flattened_data()), q) for q in (.10, .50, .90))
            lut = _piecewise_lut(source_levels, target_levels)
            shades = luma.point(lut)
            recolored = Image.merge("RGB", (shades, shades, shades.point([max(0, v-2) for v in range(256)])))
        else:
            crop = (430, 35, 1030, 480) if not mobile else (0, 90, 1080, 815)
            hue, saturation, target_levels = _reference_palette(ref_path, crop)
            lut = _piecewise_lut(source_levels, target_levels)
            value_luma = luma.point(lut)
            channels = [[], [], []]
            for value in range(256):
                red, green, blue = hsv_to_rgb(hue, saturation, value/255)
                for index, channel in enumerate((red, green, blue)):
                    channels[index].append(round(channel*255))
            recolored = Image.merge("RGB", tuple(value_luma.point(channel) for channel in channels))
        output = master.copy()
        output.paste(recolored, (0, 0), alpha)
        output.save(OUTPUT / f"hat-{color}{suffix}.png", optimize=True)
    print(f"Generated {len(COLORS)} {('mobile' if mobile else 'desktop')} variants at {width}x{height}")

if __name__ == "__main__":
    OUTPUT.mkdir(parents=True, exist_ok=True)
    generate_format(False)
    generate_format(True)
