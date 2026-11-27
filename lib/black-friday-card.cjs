'use strict';

const path = require('node:path');
const {escapeXml} = require('./black-friday-meta.cjs');

const assets = path.join(process.cwd(), 'assets', 'black-friday-meta');
process.env.FONTCONFIG_FILE ||= path.join(assets, 'fonts.conf');
const sharp = require('sharp');
const fontfile = path.join(assets, 'LiberationSans-Bold.ttf');
const width = 1080;
const height = 1350;
const ink = '#17191a';
const lime = '#deff30';

async function textLayer(value, pointSize, color, left, centerY, maxWidth) {
  const markup = '<span foreground="' + color + '">' + escapeXml(value) + '</span>';
  let {data, info} = await sharp({text:{
    text:markup, font:'Liberation Sans Bold ' + pointSize, fontfile, rgba:true, dpi:72
  }}).png().toBuffer({resolveWithObject:true});
  if (info.width > maxWidth) {
    ({data, info} = await sharp(data).resize({width:maxWidth}).png().toBuffer({resolveWithObject:true}));
  }
  return {input:data, left, top:Math.round(centerY - info.height / 2)};
}

let marks;
function brandMarks() {
  if (!marks) marks = Promise.all([
    sharp(path.join(process.cwd(), 'logo.png')).trim().resize(241).ensureAlpha()
      .linear([0, 0, 0, 1], [20, 23, 25, 0]).png().toBuffer(),
    sharp(path.join(assets, 'label.webp')).resize(365).png().toBuffer()
  ]);
  return marks;
}

async function photoLayer(bytes) {
  const original = sharp(bytes, {limitInputPixels:32_000_000}).rotate();
  const swatch = await original.clone().resize(12, 12, {fit:'fill'}).flatten({background:'#fff'})
    .removeAlpha().raw().toBuffer();
  const corners = [0, 11, 132, 143].map(i => Array.from(swatch.subarray(i * 3, i * 3 + 3)));
  const matte = corners[0];
  const studio = corners.every(pixel => pixel.every((c, i) => c > 215 && Math.abs(c - matte[i]) < 16));
  if (!studio) {
    const image = await original.resize(1080, 900, {fit:'cover', position:'centre'})
      .flatten({background:'#fff'}).png().toBuffer();
    return {background:'#fafaf8', image:{input:image, left:0, top:0}};
  }
  const bg = {r:matte[0], g:matte[1], b:matte[2]};
  const {data, info} = await original.flatten({background:bg}).trim({background:bg, threshold:18})
    .resize({width:968, height:570, fit:'inside'}).png().toBuffer({resolveWithObject:true});
  return {background:bg, image:{input:data, left:Math.round((width - info.width) / 2), top:Math.round(566 - info.height / 2)}};
}

async function renderCard(card, bytes) {
  const [photo, [logo, badge]] = await Promise.all([photoLayer(bytes), brandMarks()]);
  const panel = Buffer.from(
    '<svg width="1080" height="460" xmlns="http://www.w3.org/2000/svg">' +
    '<path fill="' + ink + '" d="M0 0H1080V460H0z"/>' +
    '<path fill="' + lime + '" d="M0 0H1080V5H0z"/>' +
    '<path stroke="#515556" stroke-width="2" d="M56 181h968"/>' +
    '</svg>');
  const model = card.name.replace(/^Арт\.\s*/i, '');
  const name = card.condition ? model + ' · ' + card.condition : model;
  const labels = await Promise.all([
    textLayer('СЕЗОН', 25, '#bfc5c2', 56, 940, 390),
    textLayer(card.season || 'Уточнюється', 54, '#ffffff', 55, 1004, 512),
    textLayer(card.sizes.length === 1 ? 'РОЗМІР EU' : 'РОЗМІРИ EU', 25, '#bfc5c2', 617, 940, 400),
    textLayer(card.sizeText, 55, '#ffffff', 615, 1004, 409),
    textLayer(card.priceText, 99, lime, 54, 1147, 520),
    textLayer(name, 37, '#ffffff', 617, 1131, 405),
    ...(card.color ? [textLayer(card.color, 26, '#c8cdca', 617, 1178, 405)] : [])
  ]);
  return sharp({create:{width, height, channels:3, background:photo.background}}).composite([
    photo.image, {input:logo, left:56, top:145}, {input:badge, left:659, top:138},
    {input:panel, left:0, top:890}, ...labels
  ]).jpeg({quality:90, mozjpeg:true, chromaSubsampling:'4:4:4'}).toBuffer();
}

module.exports = {renderCard};
