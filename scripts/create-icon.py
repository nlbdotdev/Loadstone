"""Build the native app icon from our geometric compass mark."""
from pathlib import Path
from PIL import Image, ImageDraw
root = Path(__file__).resolve().parents[1]
im = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
d.rounded_rectangle((0, 0, 255, 255), radius=48, fill='#1b2021')
d.polygon([(128,20),(209,72),(232,128),(202,196),(128,236),(54,196),(24,128),(47,72)], fill='#6c4935')
d.polygon([(128,20),(107,107),(24,128),(47,72)], fill='#e7b18a')
d.polygon([(128,20),(149,107),(232,128),(209,72)], fill='#c18b65')
d.polygon([(24,128),(107,149),(128,236),(54,196)], fill='#b98059')
d.polygon([(232,128),(149,149),(128,236),(202,196)], fill='#dfa77c')
d.polygon([(128,45),(145,111),(208,128),(145,145),(128,215),(111,145),(48,128),(111,111)], fill='#181d1e')
d.polygon([(128,66),(132,123),(178,128),(128,140)], fill='#e3b08b')
im.save(root/'public/icon.png')
im.save(root/'build/icon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
