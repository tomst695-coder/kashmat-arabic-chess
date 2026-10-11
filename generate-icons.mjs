import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { deflateSync } from "node:zlib";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const iconDirectory = path.join(projectRoot, "icons");
const knight = [[140,430],[372,430],[372,389],[348,361],[326,321],[342,281],[351,250],[337,216],[310,193],[278,190],[251,207],[233,235],[206,236],[178,260],[160,299],[167,323],[193,336],[222,337],[228,356],[207,378],[140,378]];
const samples = [[.25,.25],[.75,.25],[.25,.75],[.75,.75]];

function insidePolygon(x,y,polygon){let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const [xi,yi]=polygon[i],[xj,yj]=polygon[j];if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))inside=!inside}return inside}
function roundedRect(x,y,size,radius){const cx=Math.max(radius,Math.min(size-radius,x)),cy=Math.max(radius,Math.min(size-radius,y));return(x-cx)**2+(y-cy)**2<=radius**2}
function crc32(buffer){let crc=0xffffffff;for(const byte of buffer){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return(crc^0xffffffff)>>>0}
function chunk(name,data){const type=Buffer.from(name),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);checksum.writeUInt32BE(crc32(Buffer.concat([type,data])));return Buffer.concat([length,type,data,checksum])}
function createPng(size){const pixels=Buffer.alloc((size*4+1)*size),scale=size/512;for(let y=0;y<size;y++){const row=y*(size*4+1);pixels[row]=0;for(let x=0;x<size;x++){let bg=0,gold=0,eye=0;for(const[sx,sy]of samples){const px=(x+sx)/scale,py=(y+sy)/scale;if(roundedRect(px,py,512,90)){bg++;if(px>18&&px<494&&py>18&&py<494&&Math.min(px-18,494-px,py-18,494-py)<4)gold++;if(insidePolygon(px,py,knight)||Math.abs(py-416)<9&&px>124&&px<388)gold++}if((px-302)**2+(py-218)**2<49)eye++}const i=row+1+x*4;const dark=bg/4;const isGold=gold/4;const isEye=eye/4;const gradient=Math.max(0,Math.min(1,y/size));const base=[16+Math.round(10*gradient),26+Math.round(13*gradient),35+Math.round(14*gradient)];const icon=[229,189,115];const hole=[16,26,35];const shade=isEye?Math.min(isEye,isGold):isGold;for(let channel=0;channel<3;channel++){let value=base[channel]*(dark-shade)+icon[channel]*shade;if(isEye)value=hole[channel]*isEye+value*(1-isEye);pixels[i+channel]=Math.round(value)}pixels[i+3]=Math.round(dark*255)}}const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",deflateSync(pixels,{level:9})),chunk("IEND",Buffer.alloc(0))])}

await mkdir(iconDirectory,{recursive:true});
for(const size of [192,512,180]){const filename=size===180?"apple-touch-icon.png":`icon-${size}.png`;await writeFile(path.join(iconDirectory,filename),createPng(size))}
process.stdout.write("Generated install icons in icons/\n");
