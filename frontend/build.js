const fs = require('fs');
const path = require('path');

const srcDir = __dirname;
const distDir = path.join(__dirname, 'dist');

if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

// Copy all files from frontend to frontend/dist
const files = fs.readdirSync(srcDir);

files.forEach(file => {
    if (file !== 'dist' && file !== 'node_modules' && file !== 'package.json' && file !== 'package-lock.json' && file !== 'build.js') {
        const srcPath = path.join(srcDir, file);
        const distPath = path.join(distDir, file);

        if (fs.statSync(srcPath).isFile()) {
            fs.copyFileSync(srcPath, distPath);
            console.log(`  Copied ${file} -> dist/${file}`);
        }
    }
});

// Copy adp.html as index.html in dist for standard static hosting
if (fs.existsSync(path.join(srcDir, 'adp.html'))) {
    fs.copyFileSync(path.join(srcDir, 'adp.html'), path.join(distDir, 'index.html'));
    console.log('  Created dist/index.html (copy of adp.html)');
}

console.log('✅ Build completed successfully! Production files ready in frontend/dist/');
