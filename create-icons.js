const fs = require('fs');
const path = require('path');

// 아이콘 그림은 assets/favicon.svg 하나만 있다. 예전에는 이 파일이 사본을
// 품고 있어서, 아이콘을 바꿔도 이것을 다시 돌리면 옛 그림으로 돌아갔다.
//
// PNG/ICO 로 만드는 것은 Electron 자체가 한다 - 투명 창에 그려 capturePage 로
// 받아내고, nativeImage.resize 로 줄이고, ICO 는 PNG 를 품는 형식이므로
// 헤더만 써 붙이면 된다. 이미지 라이브러리를 다는 대신 그 방법을 쓴다.
const svgIcon = fs.readFileSync(path.join(__dirname, 'assets', 'favicon.svg'), 'utf8');

// Save SVG temporarily
fs.writeFileSync(path.join(__dirname, 'assets', 'temp-icon.svg'), svgIcon);

console.log('SVG icon created. Please convert it to ICO, ICNS, and PNG formats.');
console.log('Visit https://convertio.co/ or similar to convert the SVG to required formats.');