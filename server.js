require('dotenv').config();

const mongoose = require('mongoose');
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');
const csv = require('csv-parser');
const ldap = require('ldapjs');
const chokidar = require('chokidar');
const app = express();
const PORT = 3000;

const isLocal = process.env.RENDER === undefined; // Check if it's running locally or on Render

const REPORTS_PATH = isLocal ? '\\\\srvaitalkam\\Reporti' : path.join(__dirname, 'local_reports');
const HISTORY_PATH = '\\\\srvaitalkam\\Reporti\\Martin';
const LOG_FILE_PATH = path.join(__dirname, 'user_activity_log.txt');

console.log("🔍 MONGO_URI:", process.env.MONGO_URI);

mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 30000, 
    socketTimeoutMS: 45000, 
    maxPoolSize: 10 
}).then(() => {
    console.log("✅ Successfully connected to MongoDB Atlas!");
}).catch((err) => {
    console.error("❌ MongoDB connection error:", err);
});

const ChangeLog = require('./models/ChangeLog'); 

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

let lastKnownState = {};

async function saveChangeLog(fileName, rowIndex, columnName, oldValue, newValue, email) {
    const changeLog = new ChangeLog({
        fileName,
        rowIndex,
        columnName,
        oldValue,
        newValue,
        modifiedBy: email
    });

    try {
        await changeLog.save();
        console.log("✅ Change saved to database!");
    } catch (err) {
        console.error("❌ Error saving log:", err);
    }
}

function watchFiles() {
    console.log(`👀 Started watching ${REPORTS_PATH} and subdirectories...`);

    chokidar.watch(REPORTS_PATH, { 
        persistent: true, 
        ignoreInitial: false, 
        depth: Infinity, 
        usePolling: true, 
        interval: 1000, 
        awaitWriteFinish: {
            stabilityThreshold: 2000, 
            pollInterval: 500 
        }
    })
    .on('change', async (filePath) => {
        console.log(`🔄 File changed: ${filePath}`);
        await processFileChange(filePath);
    })
    .on('error', error => {
        console.error("❌ Error watching files:", error);
    });
}

async function processFileChange(filePath) {
    const fileName = path.basename(filePath);

    if (fileName.endsWith('.xlsx')) {
        checkExcelChanges(filePath, fileName);
    } else if (fileName.endsWith('.csv')) {
        checkCSVChanges(filePath, fileName);
    }
}

function checkExcelChanges(filePath, fileName) {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });

    if (!lastKnownState[fileName]) {
        lastKnownState[fileName] = sheetData;
        return;
    }

    console.log("Saving file to:", filePath);

    sheetData.forEach((row, rowIndex) => {
        Object.keys(row).forEach(columnName => {
            const oldValue = lastKnownState[fileName][rowIndex] ? lastKnownState[fileName][rowIndex][columnName] : "";
            const newValue = row[columnName];

            if (oldValue !== newValue) {
                console.log(`🔄 Excel change in ${fileName} -> Row: ${rowIndex}, Column: ${columnName}: ${oldValue} ➝ ${newValue}`);
                saveChangeLog(fileName, rowIndex, columnName, oldValue, newValue, "System Monitoring");
            }
        });
    });

    lastKnownState[fileName] = sheetData; 
}

function checkCSVChanges(filePath, fileName) {
    let csvData = [];
    fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => csvData.push(row))
        .on('end', () => {
            if (!lastKnownState[fileName]) {
                lastKnownState[fileName] = csvData;
                return;
            }

            csvData.forEach((row, rowIndex) => {
                Object.keys(row).forEach(columnName => {
                    const oldValue = lastKnownState[fileName][rowIndex] ? lastKnownState[fileName][rowIndex][columnName] : "";
                    const newValue = row[columnName];

                    if (oldValue !== newValue) {
                        console.log(`🔄 CSV change in ${fileName} -> Row: ${rowIndex}, Column: ${columnName}: ${oldValue} ➝ ${newValue}`);
                        saveChangeLog(fileName, rowIndex, columnName, oldValue, newValue, "System Monitoring");
                    }
                });
            });

            lastKnownState[fileName] = csvData;
        });
}

watchFiles();

function logActivity(email, action, details) {
    const timestamp = new Date().toISOString();
    const logEntry = `${timestamp} - ${email} - ${action} - ${details}\n`;

    fs.appendFile(LOG_FILE_PATH, logEntry, (err) => {
        if (err) {
            console.error("❌ Error writing log:", err);
        } else {
            console.log("✅ Log written successfully!");
        }
    });
}

app.post('/search', async (req, res) => {
    try {
        const { query, email, selectedFiles } = req.body;

        if (!query || !email) {
            return res.status(400).json({ error: 'You must provide a search query and be logged in.' });
        }

        let filesToSearch = selectedFiles && selectedFiles.length > 0 ? selectedFiles : fs.readdirSync(REPORTS_PATH).filter(file => file.endsWith('.xlsx') || file.endsWith('.csv'));

        let results = [];
        for (let fileName of filesToSearch) {
            const filePath = path.join(REPORTS_PATH, fileName);

            if (fileName.endsWith('.xlsx')) {
                const workbook = xlsx.readFile(filePath);
                const sheetName = workbook.SheetNames[0];
                const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });

                const filteredData = sheetData.filter(row =>
                    Object.values(row).some(value => value.toString().toLowerCase().includes(query.toLowerCase()))
                );

                if (filteredData.length > 0) {
                    results.push({ fileName, data: filteredData });
                }
            }
        }

        res.json(results);
    } catch (error) {
        console.error('❌ Error during search:', error);
        res.status(500).json({ error: 'Error during search.' });
    }
});

app.get('/getFiles', async (req, res) => {
    try {
        const files = fs.readdirSync(REPORTS_PATH)
            .filter(file => file.endsWith('.xlsx') || file.endsWith('.csv'));

        res.json(files);
    } catch (error) {
        console.error('❌ Error fetching files:', error);
        res.status(500).json({ error: 'Error fetching files.' });
    }
});

app.get('/details', async (req, res) => {
    try {
        const { fileName, query } = req.query;

        if (!fileName || !query) {
            return res.status(400).json({ error: "Missing file name or search query!" });
        }

        const filePath = path.join(REPORTS_PATH, fileName);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found!' });
        }

        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });

        const filteredData = sheetData.filter(row => 
            Object.values(row).some(value => value.toString().toLowerCase().includes(query.toLowerCase()))
        );

        res.json({ fileName, data: filteredData });
    } catch (error) {
        console.error("❌ Error fetching details:", error);
        res.status(500).json({ error: "Error fetching details!" });
    }
});

app.get('/history', async (req, res) => {
    try {
        const { fileName, rowIndex, columnName } = req.query;
        if (!fileName || rowIndex === undefined || !columnName) {
            return res.status(400).json({ error: "Missing parameters!" });
        }

        const changes = await ChangeLog.find({ fileName, rowIndex, columnName }).sort({ timestamp: -1 });

        res.json(changes);
    } catch (error) {
        console.error("❌ Error fetching history:", error);
        res.status(500).json({ error: "Error fetching history." });
    }
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;

    authenticateUser(email, password, (isAuthenticated) => {
        if (isAuthenticated) {
            logActivity(email, "Login", "Successful login");
            return res.json({ message: "Logged in successfully!" });
        } else {
            logActivity(email, "Login", "Failed login attempt");
            return res.status(401).json({ message: "Authentication failed!" });
        }
    });
});

function authenticateUser(email, password, callback) {
    const client = ldap.createClient({ url: 'ldap://your-ldap-server' });
    
    client.bind(email, password, (err) => {
        if (err) {
            callback(false);
        } else {
            callback(true);
        }
    });
}

app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});
