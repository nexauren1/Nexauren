-- Nexauren Tools: first PDF conversion tool
INSERT OR IGNORE INTO tools
  (id, slug, title, description, category, route, status, created_at, updated_at)
VALUES
  (
    'tool_jpg_to_pdf',
    'jpg-to-pdf',
    'JPG → PDF',
    'Converta uma ou várias imagens JPG/JPEG em um único PDF.',
    'PDF',
    '/tools/jpg-to-pdf/',
    'published',
    0,
    0
  );
