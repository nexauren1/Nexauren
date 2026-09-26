(() => {
  const fileInput = document.getElementById("file-input");
  const dropZone = document.getElementById("drop-zone");
  const filePanel = document.getElementById("file-panel");
  const fileList = document.getElementById("file-list");
  const fileCount = document.getElementById("file-count");
  const clearButton = document.getElementById("clear-button");
  const convertButton = document.getElementById("convert-button");
  const outputName = document.getElementById("output-name");
  const pageSize = document.getElementById("page-size");
  const status = document.getElementById("status");
  const menuToggle = document.getElementById("menu-toggle");
  const nav = document.getElementById("main-nav");

  let files = [];
  let lang = localStorage.getItem("nexauren-tools-language") === "en" ? "en" : "pt";

  const t = {
    pt: {
      menu:"Menu", home:"Início", tools:"Ferramentas", account:"Conta", pdf:"PDF",
      title:"JPG → PDF",
      lead:"Converta uma ou várias imagens JPG/JPEG num único PDF diretamente no navegador.",
      addTitle:"Adicione as suas imagens", dropText:"Arraste e solte aqui ou escolha arquivos do dispositivo.",
      choose:"Selecionar JPG", hint:"JPG/JPEG · várias imagens permitidas · processamento local",
      files:"ARQUIVOS", clear:"Limpar", filename:"Nome do PDF", pageSize:"Tamanho da página",
      fit:"Ajustar à imagem", a4:"A4", convert:"Criar PDF",
      privateTitle:"Privado", privateText:"As imagens não precisam de ser enviadas para um servidor.",
      multiTitle:"Várias imagens", multiText:"Organize várias páginas num único documento.",
      fastTitle:"Rápido", fastText:"Ideal para documentos simples, digitalizações e anexos.",
      footer:"Nexauren Tools · JPG → PDF",
      invalid:"Selecione arquivos JPG ou JPEG.",
      preparing:"A preparar o PDF…", processing:(i,n)=>"A processar " + i + " de " + n + "…",
      success:"PDF criado. O download foi iniciado.",
      error:"Não foi possível criar o PDF.",
      remove:"Remover"
    },
    en: {
      menu:"Menu", home:"Home", tools:"Tools", account:"Account", pdf:"PDF",
      title:"JPG → PDF",
      lead:"Convert one or more JPG/JPEG images into a single PDF directly in your browser.",
      addTitle:"Add your images", dropText:"Drag and drop here or choose files from your device.",
      choose:"Select JPG", hint:"JPG/JPEG · multiple images allowed · local processing",
      files:"FILES", clear:"Clear", filename:"PDF name", pageSize:"Page size",
      fit:"Fit to image", a4:"A4", convert:"Create PDF",
      privateTitle:"Private", privateText:"Your images do not need to be uploaded to a server.",
      multiTitle:"Multiple images", multiText:"Arrange several pages into one document.",
      fastTitle:"Fast", fastText:"Useful for simple documents, scans and attachments.",
      footer:"Nexauren Tools · JPG → PDF",
      invalid:"Select JPG or JPEG files.",
      preparing:"Preparing the PDF…", processing:(i,n)=>"Processing " + i + " of " + n + "…",
      success:"PDF created. The download has started.",
      error:"Unable to create the PDF.",
      remove:"Remove"
    }
  };

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  const formatBytes = (bytes) => {
    if (bytes < 1024) return bytes + " B";
    const units = ["KB","MB","GB"];
    let value = bytes / 1024, unit = units[0];
    for (let i=1;i<units.length && value>=1024;i++) { value /= 1024; unit = units[i]; }
    return value.toFixed(value >= 10 ? 0 : 1) + " " + unit;
  };
  const isJpeg = (file) => file && (file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name));

  function applyLanguage() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach((node) => {
      const key = node.dataset.i18n;
      if (t[lang][key] != null) node.textContent = t[lang][key];
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
      const key = node.dataset.i18nPlaceholder;
      if (t[lang][key] != null) node.placeholder = t[lang][key];
    });
    document.getElementById("lang-pt").classList.toggle("active", lang === "pt");
    document.getElementById("lang-en").classList.toggle("active", lang === "en");
    document.title = "JPG → PDF — Nexauren Tools";
    render();
  }

  function addFiles(list) {
    const incoming = [...list].filter(isJpeg);
    if (!incoming.length) { status.textContent = t[lang].invalid; return; }
    const known = new Set(files.map((file) => file.name + ":" + file.size + ":" + file.lastModified));
    for (const file of incoming) {
      const key = file.name + ":" + file.size + ":" + file.lastModified;
      if (!known.has(key)) { files.push(file); known.add(key); }
    }
    render();
  }

  function render() {
    filePanel.hidden = files.length === 0;
    fileCount.textContent = files.length === 1
      ? (lang === "pt" ? "1 imagem" : "1 image")
      : (lang === "pt" ? files.length + " imagens" : files.length + " images");
    fileList.innerHTML = files.map((file,index) => {
      const url = URL.createObjectURL(file);
      return '<div class="file-row">' +
        '<img class="thumb" src="' + url + '" alt="" data-preview="' + index + '">' +
        '<div class="file-meta"><strong>' + esc(file.name) + '</strong><span>' + formatBytes(file.size) + '</span></div>' +
        '<button class="remove-file" type="button" data-remove="' + index + '">' + esc(t[lang].remove) + '</button></div>';
    }).join("");
    fileList.querySelectorAll("img[data-preview]").forEach((img) => img.addEventListener("load", () => URL.revokeObjectURL(img.src), {once:true}));
    convertButton.disabled = files.length === 0;
  }

  fileList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove]");
    if (!button) return;
    files.splice(Number(button.dataset.remove), 1);
    render();
  });
  clearButton.addEventListener("click", () => { files=[]; fileInput.value=""; render(); status.textContent=""; });
  fileInput.addEventListener("change", () => addFiles(fileInput.files));
  dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); fileInput.click(); }
  });
  ["dragenter","dragover"].forEach((type) => dropZone.addEventListener(type, (event) => { event.preventDefault(); dropZone.classList.add("dragging"); }));
  ["dragleave","drop"].forEach((type) => dropZone.addEventListener(type, (event) => { event.preventDefault(); dropZone.classList.remove("dragging"); }));
  dropZone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));

  document.getElementById("lang-pt").addEventListener("click", () => { lang="pt"; localStorage.setItem("nexauren-tools-language",lang); applyLanguage(); });
  document.getElementById("lang-en").addEventListener("click", () => { lang="en"; localStorage.setItem("nexauren-tools-language",lang); applyLanguage(); });

  if (menuToggle && nav) {
    menuToggle.addEventListener("click", () => {
      const open = menuToggle.getAttribute("aria-expanded") === "true";
      menuToggle.setAttribute("aria-expanded", String(!open));
      nav.classList.toggle("is-open", !open);
    });
    nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
      menuToggle.setAttribute("aria-expanded", "false");
      nav.classList.remove("is-open");
    }));
  }

  function ascii(value) { return new TextEncoder().encode(value); }
  function concatBytes(chunks) {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
    return out;
  }
  function jpegInfo(bytes) {
    if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) throw new Error("Invalid JPEG");
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset] !== 0xFF) { offset++; continue; }
      let marker = bytes[offset + 1];
      offset += 2;
      while (marker === 0xFF && offset < bytes.length) marker = bytes[offset++];
      if (marker === 0xD8 || marker === 0xD9 || marker === 0x01) continue;
      if (offset + 2 > bytes.length) break;
      const length = (bytes[offset] << 8) | bytes[offset + 1];
      if (length < 2 || offset + length > bytes.length) break;
      const isSOF = [0xC0,0xC1,0xC2,0xC3,0xC5,0xC6,0xC7,0xC9,0xCA,0xCB,0xCD,0xCE,0xCF].includes(marker);
      if (isSOF) return {
        width:(bytes[offset+5] << 8) | bytes[offset+6],
        height:(bytes[offset+3] << 8) | bytes[offset+4],
        components:bytes[offset+7]
      };
      offset += length;
    }
    throw new Error("Invalid JPEG dimensions");
  }
  async function blobBytes(file) { return new Uint8Array(await file.arrayBuffer()); }

  function buildPdf(images) {
    const objects = [];
    const pageRefs = [];
    let nextId = 3, pagesId = 2, catalogId = 1;
    for (const image of images) {
      const imageId = nextId++, contentId = nextId++, pageId = nextId++;
      const iw = image.width, ih = image.height;
      let pageW, pageH, drawW, drawH, x, y;
      if (pageSize.value === "a4") {
        pageW = 595.28; pageH = 841.89;
        const scale = Math.min((pageW-56)/iw, (pageH-56)/ih);
        drawW = iw*scale; drawH = ih*scale; x=(pageW-drawW)/2; y=(pageH-drawH)/2;
      } else {
        const maxPt = 1440, scale = Math.min(1,maxPt/iw,maxPt/ih);
        drawW=iw*scale; drawH=ih*scale; pageW=drawW; pageH=drawH; x=0; y=0;
      }
      const content = ascii("q\n" + drawW.toFixed(2) + " 0 0 " + drawH.toFixed(2) + " " + x.toFixed(2) + " " + y.toFixed(2) + " cm\n/Im0 Do\nQ\n");
      const colorSpace = image.components === 1 ? "/DeviceGray" : image.components === 4 ? "/DeviceCMYK" : "/DeviceRGB";
      objects[imageId] = {value:concatBytes([
        ascii("<< /Type /XObject /Subtype /Image /Width " + iw + " /Height " + ih + " /ColorSpace " + colorSpace + " /BitsPerComponent 8 /Filter /DCTDecode /Length " + image.data.length + " >>\nstream\n"),
        image.data, ascii("\nendstream")
      ])};
      objects[contentId] = {value:concatBytes([ascii("<< /Length " + content.length + " >>\nstream\n"),content,ascii("endstream")])};
      objects[pageId] = {value:ascii("<< /Type /Page /Parent " + pagesId + " 0 R /MediaBox [0 0 " + pageW.toFixed(2) + " " + pageH.toFixed(2) + "] /Resources << /XObject << /Im0 " + imageId + " 0 R >> >> /Contents " + contentId + " 0 R >>")};
      pageRefs.push(pageId + " 0 R");
    }
    objects[pagesId] = {value:ascii("<< /Type /Pages /Kids [" + pageRefs.join(" ") + "] /Count " + pageRefs.length + " >>")};
    objects[catalogId] = {value:ascii("<< /Type /Catalog /Pages " + pagesId + " 0 R >>")};
    const chunks=[ascii("%PDF-1.4\n%\xFF\xFF\xFF\xFF\n")], offsets=new Array(objects.length).fill(0);
    let position=chunks[0].length;
    for(let id=1;id<objects.length;id++){
      if(!objects[id]) continue;
      const header=ascii(id+" 0 obj\n"), body=objects[id].value, footer=ascii("\nendobj\n");
      offsets[id]=position; chunks.push(header,body,footer); position+=header.length+body.length+footer.length;
    }
    const xrefOffset=position;
    chunks.push(ascii("xref\n0 " + objects.length + "\n0000000000 65535 f \n"));
    for(let id=1;id<objects.length;id++) chunks.push(ascii(String(offsets[id]).padStart(10,"0")+" 00000 n \n"));
    chunks.push(ascii("trailer\n<< /Size " + objects.length + " /Root " + catalogId + " 0 R >>\nstartxref\n" + xrefOffset + "\n%%EOF"));
    return concatBytes(chunks);
  }

  convertButton.addEventListener("click", async () => {
    if (!files.length) return;
    convertButton.disabled=true; status.textContent=t[lang].preparing;
    try {
      const images=[];
      for(let i=0;i<files.length;i++){
        status.textContent=t[lang].processing(i+1,files.length);
        const data=await blobBytes(files[i]);
        const info=jpegInfo(data);
        images.push({data,width:info.width,height:info.height,components:info.components});
      }
      const pdf=buildPdf(images);
      const blob=new Blob([pdf],{type:"application/pdf"});
      const url=URL.createObjectURL(blob);
      const anchor=document.createElement("a");
      anchor.href=url;
      const cleanName=(outputName.value.trim()||"nexauren-jpg.pdf").replace(/[^a-z0-9._-]+/gi,"-");
      anchor.download=/\.pdf$/i.test(cleanName)?cleanName:cleanName+".pdf";
      anchor.click();
      setTimeout(()=>URL.revokeObjectURL(url),1500);
      status.textContent=t[lang].success;
    } catch(error) {
      console.error(error);
      status.textContent=t[lang].error;
    } finally {
      convertButton.disabled=files.length===0;
    }
  });

  applyLanguage();
})();