const id = process.argv.find((value) => value !== '--' && value !== process.argv[0] && value !== process.argv[1]);
if (!id) { console.error('Usage: npm run publisher:embed -- publisher-id'); process.exit(1); }
console.log(`<script src="https://YOUR-WIDGET-HOST.example/widget.js" data-publisher="${id}" data-position="bottom-right"></script>`);
console.log('The embed collects company website and job role, then navigates to hosted generation. Use data-position="bottom-left" when needed. data-debug="true" is development-host only and should not be included in production snippets.');
