const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const axios = require('axios');
const FormData = require('form-data');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const app = express();
app.use(cors());

// Configure Multer for temporary file uploads
const upload = multer({ dest: 'uploads/' });

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// Detect Operating System for Ghostscript command
const isWindows = process.platform === 'win32';
const gsCommandBase = isWindows ? 'gswin64c' : 'gs';

// ==========================================
// 1. TEXT TO OUTLINE (TRUE VECTOR) ENDPOINT
// ==========================================
app.post('/api/outline', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');

    const inputPath = path.resolve(req.file.path);
    const outputPath = path.resolve(`${req.file.path}_outlined.pdf`);

    // Ghostscript command to convert all text to vector paths (NoOutputFonts)
    const gsCommand = `"${gsCommandBase}" -o "${outputPath}" -sDEVICE=pdfwrite -dNoOutputFonts "${inputPath}"`;

    exec(gsCommand, (error, stdout, stderr) => {
        if (error) {
            console.error(`Ghostscript Error: ${error.message}`);
            console.error(`Please ensure Ghostscript is installed and added to your system PATH.`);
            return res.status(500).send('Error converting text to outline. Is Ghostscript installed?');
        }

        // Send the true vector PDF back to the frontend
        res.download(outputPath, 'GCI_Vector_Outlined.pdf', (err) => {
            // Clean up temp files safely
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        });
    });
});

// ==========================================
// 2. CDR TO PDF VIEWER ENDPOINT
// ==========================================
app.post('/api/cdr-to-pdf', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');
    const inputPath = path.resolve(req.file.path);

    // TODO: Paste your Zamzar API Key here for production CDR conversions
    const ZAMZAR_API_KEY = "YOUR_ZAMZAR_API_KEY_HERE"; 

    try {
        if (ZAMZAR_API_KEY === "YOUR_ZAMZAR_API_KEY_HERE") {
            // FALLBACK: If no API key is set, generate a fallback PDF so the frontend doesn't crash.
            const pdfDoc = await PDFDocument.create();
            const page = pdfDoc.addPage([600, 400]);
            const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
            page.drawText('CDR Viewer API Not Configured', { x: 50, y: 300, size: 24, font, color: rgb(0.8, 0.1, 0.1) });
            page.drawText('Please add your Zamzar API Key in server.js (Line 58)', { x: 50, y: 250, size: 14 });
            const pdfBytes = await pdfDoc.save();
            
            const fallbackPath = `${inputPath}_fallback.pdf`;
            fs.writeFileSync(fallbackPath, pdfBytes);
            
            return res.download(fallbackPath, 'CDR_Notice.pdf', () => {
                if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                if (fs.existsSync(fallbackPath)) fs.unlinkSync(fallbackPath);
            });
        }

        // REAL API CALL TO ZAMZAR
        const formData = new FormData();
        formData.append('source_file', fs.createReadStream(inputPath));
        formData.append('target_format', 'pdf');

        // 1. Start Job
        const jobRes = await axios.post('https://sandbox.zamzar.com/v1/jobs', formData, {
            headers: { ...formData.getHeaders(), 'Authorization': `Basic ${Buffer.from(ZAMZAR_API_KEY + ':').toString('base64')}` }
        });
        const jobId = jobRes.data.id;

        // 2. Wait for completion (Polling)
        let fileId = null;
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const statusRes = await axios.get(`https://sandbox.zamzar.com/v1/jobs/${jobId}`, {
                headers: { 'Authorization': `Basic ${Buffer.from(ZAMZAR_API_KEY + ':').toString('base64')}` }
            });
            if (statusRes.data.status === 'successful') {
                fileId = statusRes.data.target_files[0].id;
                break;
            }
        }

        if (!fileId) throw new Error("Conversion timed out");

        // 3. Download Result
        const outputPath = `${inputPath}_converted.pdf`;
        const downloadRes = await axios.get(`https://sandbox.zamzar.com/v1/files/${fileId}/content`, {
            responseType: 'stream',
            headers: { 'Authorization': `Basic ${Buffer.from(ZAMZAR_API_KEY + ':').toString('base64')}` }
        });

        const writer = fs.createWriteStream(outputPath);
        downloadRes.data.pipe(writer);
        
        writer.on('finish', () => {
            res.download(outputPath, 'Converted_CDR.pdf', () => {
                if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            });
        });

    } catch (error) {
        console.error("CDR Conversion Error:", error.message);
        res.status(500).send("CDR Conversion failed.");
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n=========================================`);
    console.log(`🚀 GCI-HCreations Backend Running!`);
    console.log(`👉 Local API available at: http://localhost:${PORT}`);
    console.log(`=========================================\n`);
});