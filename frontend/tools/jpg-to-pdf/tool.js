const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');
const filePanel = document.getElementById('file-panel');
const fileList = document.getElementById('file-list');
const fileCount = document.getElementById('file-count');
const clearButton = document.getElementById('clear-button');
const convertButton = document.getElementById('convert-button');
const outputName = document.getElementById('output-name');
const pageSize = document.getElementById('page-size');
const status = document.getElementById('status');

let files = [];

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
  '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'
}[char]));

function formatBytes(bytes){
  if(bytes < 1024) return bytes + ' B';
  const units = ['KB','MB','GB'];
  let value = bytes / 1024;
  let unit = units[0];
  for(let i=1;i<units.length && value>=1024;i++){ value /= 1024; unit = units[i]; }
  return value.toFixed(value >= 10 ? 0 : 1) + ' ' + unit;
}

function isJpeg(file){
  return file && (file.type === 'image/jpeg' || /\.(jpe?g)$/i.test(file.name));
}

function addFiles(list){
  const incoming = [...list].filter(isJpeg);
  if(!incoming.length) {
    status.textContent = 'Selecione arquivos JPG ou JPEG.';
    return;
  }
  const known = new Set(files.map((file) => file.name + ':' + file.size + ':' + file.lastModified));
  for(const file of incoming){
    const key = file.name + ':' + file.size + ':' + file.lastModified;
    if(!known.has(key)){ files.push(file); known.add(key); }
  }
  render();
}

function render(){
  filePanel.hidden = files.length === 0;
  fileCount.textContent = files.length === 1 ? '1 imagem' : files.length + ' imagens';
  fileList.innerHTML = files.map((file,index) => {
    const url = URL.createObjectURL(file);
    return '<div class="file-row">' +
      '<img class="thumb" src="' + url + '" alt="" data-preview="' + index + '">' +
      '<div class="file-meta"><strong>' + escapeHtml(file.name) + '</strong><span>' + formatBytes(file.size) + '</span></div>' +
      '<button class="remove-file" type="button" data-remove="' + index + '" aria-label="Remover ' + escapeHtml(file.name) + '">Remover</button>' +
      '</div>';
  }).join('');
  fileList.querySelectorAll('img[data-preview]').forEach((img) => {
    img.addEventListener('load', () => URL.revokeObjectURL(img.src), {once:true});
  });
  convertButton.disabled = files.length === 0;
  status.textContent = '';
}

fileList.addEventListener('click',(event)=>{
  const button = event.target.closest('[data-remove]');
  if(!button) return;
  const index = Number(button.dataset.remove);
  files.splice(index,1);
  render();
});

clearButton.addEventListener('click',()=>{ files=[]; fileInput.value=''; render(); });

fileInput.addEventListener('change',()=>addFiles(fileInput.files));
dropZone.addEventListener('keydown',(event)=>{
  if(event.key === 'Enter' || event.key === ' '){ event.preventDefault(); fileInput.click(); }
});
['dragenter','dragover'].forEach(type=>dropZone.addEventListener(type,(event)=>{
  event.preventDefault(); dropZone.classList.add('dragging');
}));
['dragleave','drop'].forEach(type=>dropZone.addEventListener(type,(event)=>{
  event.preventDefault(); dropZone.classList.remove('dragging');
}));
dropZone.addEventListener('drop',(event)=>addFiles(event.dataTransfer.files));

function u8(bytes){
  return new Uint8Array(bytes);
}

function concatBytes(chunks){
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for(const chunk of chunks){ out.set(chunk, offset); offset += chunk.length; }
  return out;
}

function ascii(value){ return new TextEncoder().encode(value); }

function jpegInfo(bytes){
  if(bytes[0] !== 0xFF || bytes[1] !== 0xD8) throw new Error('Arquivo JPG inválido.');
  let offset = 2;
  while(offset < bytes.length){
    if(bytes[offset] !== 0xFF){ offset++; continue; }
    let marker = bytes[offset + 1];
    offset += 2;
    if(marker === 0xD9 || marker === 0xDA) break;
    while(marker === 0xFF) marker = bytes[offset++];
    if([0xD8,0xD9,0x01].includes(marker)) continue;
    if(offset + 2 > bytes.length) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if(length < 2 || offset + length > bytes.length) break;
    const isSOF = [0xC0,0xC1,0xC2,0xC3,0xC5,0xC6,0xC7,0xC9,0xCA,0xCB,0xCD,0xCE,0xCF].includes(marker);
    if(isSOF){
      const height = (bytes[offset+3] << 8) | bytes[offset+4];
      const width = (bytes[offset+5] << 8) | bytes[offset+6];
      const components = bytes[offset+7];
      return {width,height,components};
    }
    offset += length;
  }
  throw new Error('Não foi possível ler as dimensões do JPG.');
}

async function blobBytes(file){ return u8(await file.arrayBuffer()); }

function buildPdf(images){
  const objects = [];
  const pageRefs = [];
  let nextId = 3;

  const pagesId = 2;
  const catalogId = 1;
  const fontId = null;

  for(const image of images){
    const imageId = nextId++;
    const contentId = nextId++;
    const pageId = nextId++;
    const {width: iw, height: ih, data} = image;
    let pageW, pageH, drawW, drawH, x, y;

    if(pageSize.value === 'a4'){
      const a4w = 595.28, a4h = 841.89;
      pageW = a4w; pageH = a4h;
      const scale = Math.min((pageW-56)/iw, (pageH-56)/ih);
      drawW = iw * scale; drawH = ih * scale;
      x = (pageW-drawW)/2; y = (pageH-drawH)/2;
    } else {
      const maxPt = 1440;
      const scale = Math.min(1, maxPt / iw, maxPt / ih);
      drawW = iw * scale; drawH = ih * scale;
      pageW = drawW; pageH = drawH; x=0; y=0;
    }

    const content = ascii('q\n' + drawW.toFixed(2) + ' 0 0 ' + drawH.toFixed(2) + ' ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' cm\n/Im0 Do\nQ\n');
    objects[imageId] = {type:'binary', value:concatBytes([
      ascii('<< /Type /XObject /Subtype /Image /Width ' + iw + ' /Height ' + ih + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + data.length + ' >>\nstream\n'),
      data,
      ascii('\nendstream')
    ])};
    objects[contentId] = {type:'text', value:concatBytes([
      ascii('<< /Length ' + content.length + ' >>\nstream\n'),
      content,
      ascii('endstream')
    ])};
    objects[pageId] = {type:'text', value:ascii('<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 ' + pageW.toFixed(2) + ' ' + pageH.toFixed(2) + '] /Resources << /XObject << /Im0 ' + imageId + ' 0 R >> >> /Contents ' + contentId + ' 0 R >>')};
    pageRefs.push(pageId + ' 0 R');
  }

  objects[pagesId] = {type:'text', value:ascii('<< /Type /Pages /Kids [' + pageRefs.join(' ') + '] /Count ' + pageRefs.length + ' >>')};
  objects[catalogId] = {type:'text', value:ascii('<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>')};

  const chunks = [ascii('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n')];
  const offsets = new Array(objects.length).fill(0);
  let position = chunks[0].length;

  for(let id=1; id<objects.length; id++){
    if(!objects[id]) continue;
    const header = ascii(id + ' 0 obj\n');
    const body = objects[id].value;
    const footer = ascii('\nendobj\n');
    offsets[id] = position;
    chunks.push(header, body, footer);
    position += header.length + body.length + footer.length;
  }

  const xrefOffset = position;
  chunks.push(ascii('xref\n0 ' + objects.length + '\n0000000000 65535 f \n'));
  for(let id=1; id<objects.length; id++) chunks.push(ascii(String(offsets[id]).padStart(10,'0') + ' 00000 n \n'));
  chunks.push(ascii('trailer\n<< /Size ' + objects.length + ' /Root ' + catalogId + ' 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF'));
  return concatBytes(chunks);
}

convertButton.addEventListener('click', async ()=>{
  if(!files.length) return;
  convertButton.disabled = true;
  status.textContent = 'A preparar o PDF…';
  try{
    const images = [];
    for(let i=0;i<files.length;i++){
      status.textContent = 'A processar ' + (i+1) + ' de ' + files.length + '…';
      const data = await blobBytes(files[i]);
      const info = jpegInfo(data);
      images.push({data,width:info.width,height:info.height});
    }
    const pdf = buildPdf(images);
    const blob = new Blob([pdf],{type:'application/pdf'});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    const cleanName = (outputName.value.trim() || 'nexauren-jpg.pdf').replace(/[^a-z0-9._-]+/gi,'-');
    anchor.download = cleanName.toLowerCase().endsWith('.pdf') ? cleanName : cleanName + '.pdf';
    anchor.click();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
    status.textContent = 'PDF criado. O download foi iniciado.';
  }catch(error){
    console.error(error);
    status.textContent = error?.message || 'Não foi possível criar o PDF.';
  }finally{
    convertButton.disabled = files.length === 0;
  }
});

render();
