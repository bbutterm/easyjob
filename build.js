/* Сборка автономного index.html из файлов каталога src/.
   Запуск: node build.js
   Внешние зависимости не используются, сеть не требуется. */

'use strict';

var fs = require('fs');
var path = require('path');

var SRC = path.join(__dirname, 'src');
var OUT = path.join(__dirname, 'index.html');

function read(name) {
  return fs.readFileSync(path.join(SRC, name), 'utf8');
}

var html = read('index.html');
var css = read('styles.css');

var scripts = ['../shared/text/segment.js', '../shared/tts/index.js', '../shared/stt/index.js', '../shared/stt/widget.js', 'professions.js', 'data.js', 'state.js', 'ui.js', 'api.js', 'screens-core.js', 'screens-prep.js', 'quickstart.js', 'app.js'];

html = html.replace(
  '<link rel="stylesheet" href="styles.css">',
  '<style>\n' + css + '\n</style>'
);

scripts.forEach(function (name) {
  var code = read(name);
  if (code.indexOf('</script>') >= 0) {
    throw new Error('В файле ' + name + ' встречается закрывающий тег script.');
  }
  html = html.replace(
    '<script src="' + name + '"></script>',
    '<script>\n/* ==== ' + name + ' ==== */\n' + code + '\n</script>'
  );
});

var banner = '<!-- Автономная сборка. Исходники — в каталоге src/, пересборка: node build.js -->\n';
fs.writeFileSync(OUT, banner + html, 'utf8');

var size = Buffer.byteLength(html, 'utf8');
console.log('index.html собран: ' + Math.round(size / 1024) + ' КБ');
