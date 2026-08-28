/* eslint-disable */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const outDir = path.join(__dirname, '..', 'public', 'icons');
const logoPath = path.join(__dirname, '..', 'public', '1130f5ee-b20d-41b4-89c5-23c877b4d396.jpg');

async function createIcon(size, filename, maskable = false) {
  const padding = maskable ? Math.round(size * 0.2) : Math.round(size * 0.08);
  const inner = size - padding * 2;

  let image = sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 21, g: 128, b: 61, alpha: 1 },
    },
  });

  if (fs.existsSync(logoPath)) {
    const logo = await sharp(logoPath)
      .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    image = sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 21, g: 128, b: 61, alpha: 1 },
      },
    }).composite([{ input: logo, top: padding, left: padding }]);
  }

  await image.png().toFile(path.join(outDir, filename));
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  await createIcon(192, 'icon-192.png');
  await createIcon(512, 'icon-512.png');
  await createIcon(512, 'icon-512-maskable.png', true);
  console.log('PWA icons generated in public/icons/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
