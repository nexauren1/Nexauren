# Nexauren

New clean foundation for the Nexauren platform.

## Current direction

The project starts with **Nexauren Books**. Books is a focused experience with its own navigation, visual language and content model. Music and Tools are prepared as separate future experiences.

The platform concept is:

- one Nexauren account;
- separate experiences for Books, Music and Tools;
- shared platform infrastructure only where it makes sense;
- no storage provider is locked in yet;
- no invented live products in the catalogue.

## Frontend layout

```text
frontend/
├── index.html
├── books/
│   ├── index.html
│   ├── books.css
│   └── books.js
├── music/
│   └── index.html
├── tools/
│   └── index.html
├── account/
│   └── index.html
├── legal/
│   ├── about.html
│   ├── faq.html
│   ├── privacy.html
│   ├── terms.html
│   ├── cookies.html
│   └── legal.css
├── styles/
│   └── home.css
└── scripts/
    └── home.js
```

The current frontend is intentionally static. Authentication, the existing payment system and production API routes should be connected from the working backend after its structure is mapped, rather than recreated with placeholder integrations.

## Design principles

- light, warm surfaces instead of black-first branding;
- strong contrast and visible focus states;
- responsive navigation and mobile layouts;
- clear page titles and section hierarchy;
- Books does not display Music or Tools activity inside the Books experience.
