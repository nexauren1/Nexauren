window.NEXAUREN_TOOL_DATA = {
  version: 1,
  categories: [
    {
      id: "pdf",
      slug: "pdf",
      icon: "PDF",
      title: { pt: "PDF", en: "PDF" },
      description: {
        pt: "Conversão, organização e ferramentas para trabalhar com documentos PDF.",
        en: "Conversion, organization and utilities for working with PDF documents."
      }
    }
  ],
  tools: [
    {
      id: "jpg-to-pdf",
      slug: "jpg-to-pdf",
      title: { pt: "JPG → PDF", en: "JPG → PDF" },
      description: {
        pt: "Converta uma ou várias imagens JPG/JPEG num único PDF diretamente no navegador.",
        en: "Convert one or more JPG/JPEG images into a single PDF directly in your browser."
      },
      category: "pdf",
      route: "/tool/jpg-to-pdf/",
      status: "published",
      access: "free",
      icon: "JPG"
    }
  ]
};