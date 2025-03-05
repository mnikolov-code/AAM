const mongoose = require('mongoose');
const ChangeLog = require('./models/ChangeLog'); // Импортирај го моделот за логови

mongoose.connect('mongodb://localhost:27017/asset_tracking')

    .then(() => console.log("✅ Connected to MongoDB"))
    .catch(err => console.error("❌ Error connecting to MongoDB:", err));

// ОТСТРАНИЈ ГО ОВОЈ ДВОЕН ИМПОРТ!
// const ChangeLog = require('./models/ChangeLog'); 

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
        console.log("✅ Промената е зачувана во базата!");
    } catch (err) {
        console.error("❌ Грешка при зачувување на логот:", err);
    }
}

const chokidar = require('chokidar'); // 📌 Додај ја оваа библиотека (потребно е `npm install chokidar`)

// 📌 Директориум кој ќе се следи (прилагоди ја локацијата ако треба)
const WATCHED_FOLDER = '\\\\srvaitalkam\\Reporti';

// 📌 Чување на старата состојба на датотеките
let lastKnownState = {};

// Функција за следење на фајлови во реално време
function watchFiles() {
    console.log(`👀 Започнато следење на ${WATCHED_FOLDER} и сите поддиректориуми...`);

    chokidar.watch(WATCHED_FOLDER, { 
        persistent: true, 
        ignoreInitial: false, 
        depth: Infinity, 
        usePolling: true, // 🛠️ Додава polling за стабилност на мрежни папки
        interval: 1000, // 📌 Проверува на секоја 1 секунда за промени
        awaitWriteFinish: {
            stabilityThreshold: 2000, // 🛠️ Чека 2 секунди за да се заврши пишувањето пред да реагира
            pollInterval: 500 
        }
    })
    .on('change', async (filePath) => {
        console.log(`🔄 Фајлот е изменет: ${filePath}`);
        await processFileChange(filePath); // Осигурува дека ќе чека додека не се обработи промената
    })
    .on('error', error => {
        console.error("❌ Грешка при следење на фолдерите:", error);
    });
}

// 🔹 Започни го следењето на фајловите
watchFiles();


// Функција за обработка на измените
async function processFileChange(filePath) {
    const fileName = path.basename(filePath);

    if (fileName.endsWith('.xlsx')) {
        checkExcelChanges(filePath, fileName);
    } else if (fileName.endsWith('.csv')) {
        checkCSVChanges(filePath, fileName);
    }
}




// 📌 Функција за следење на промени во Excel
function checkExcelChanges(filePath, fileName) {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });

    if (!lastKnownState[fileName]) {
        lastKnownState[fileName] = sheetData;
        return;
    }

    sheetData.forEach((row, rowIndex) => {
        Object.keys(row).forEach(columnName => {
            const oldValue = lastKnownState[fileName][rowIndex] ? lastKnownState[fileName][rowIndex][columnName] : "";
            const newValue = row[columnName];

            if (oldValue !== newValue) {
                console.log(`🔄 Excel промена во ${fileName} -> Ред: ${rowIndex}, Колона: ${columnName}: ${oldValue} ➝ ${newValue}`);

                saveChangeLog(fileName, rowIndex, columnName, oldValue, newValue, "Системско следење");
            }
        });
    });

    lastKnownState[fileName] = sheetData; // Ажурирај ја состојбата
}

// 📌 Функција за следење на промени во CSV
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
                        console.log(`🔄 CSV промена во ${fileName} -> Ред: ${rowIndex}, Колона: ${columnName}: ${oldValue} ➝ ${newValue}`);

                        saveChangeLog(fileName, rowIndex, columnName, oldValue, newValue, "Системско следење");
                    }
                });
            });

            lastKnownState[fileName] = csvData; // Ажурирај ја состојбата
        });
}

// 🔹 Започни го следењето на фајловите
watchFiles();



const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');
const csv = require('csv-parser');
const ldap = require('ldapjs');

const app = express();
const PORT = 3000;

// Патеки до фолдерите
const REPORTS_PATH = '\\\\srvaitalkam\\Reporti';
const HISTORY_PATH = '\\\\srvaitalkam\\Reporti\\Martin';
const LOG_FILE_PATH = path.join(__dirname, 'user_activity_log.txt');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// Функција за читање на Excel и CSV фајлови
function readFilesFromDirectory(directory) {
    return new Promise((resolve, reject) => {
        fs.readdir(directory, (err, files) => {
            if (err) {
                console.error("❌ Грешка при читање на директориумот:", err);
                reject(err);
                return;
            }

            console.log("📂 Најдени фајлови:", files);
            let results = [];
            let pending = files.length;

            if (!pending) resolve(results);

            files.forEach(file => {
                const filePath = path.join(directory, file);

                if (file.endsWith('.xlsx')) {
                    const workbook = xlsx.readFile(filePath);
                    const sheetName = workbook.SheetNames;
                    const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
                    console.log(`📖 Excel фајл прочитан: ${file}, редови: ${sheetData.length}`);
                    results.push({ fileName: file, data: sheetData });
                    if (!--pending) resolve(results);
                } else if (file.endsWith('.csv')) {
                    let csvData = [];
                    fs.createReadStream(filePath)
                        .pipe(csv())
                        .on('data', (row) => csvData.push(row))
                        .on('end', () => {
                            console.log(`📖 CSV фајл прочитан: ${file}, редови: ${csvData.length}`);
                            results.push({ fileName: file, data: csvData });
                            if (!--pending) resolve(results);
                        });
                } else {
                    if (!--pending) resolve(results);
                }
            });
        });
    });
}

// Функција за логирање на активности
function logActivity(email, action, details) {
    const timestamp = new Date().toISOString();
    const logEntry = `${timestamp} - ${email} - ${action} - ${details}\n`;

    fs.appendFile(LOG_FILE_PATH, logEntry, (err) => {
        if (err) {
            console.error("❌ Грешка при запишување на лог:", err);
        } else {
            console.log("✅ Логот е успешно запишан!");
        }
    });
}

app.post('/search', async (req, res) => {
    try {
        const { query, email, selectedFiles } = req.body;

        if (!query || !email) {
            return res.status(400).json({ error: 'Мора да внесете критериум за пребарување и да бидете најавени.' });
        }

        logActivity(email, "Пребарување", `Барање: ${query}`);

        let filesToSearch;
        if (selectedFiles && selectedFiles.length > 0) {
            filesToSearch = selectedFiles; // Пребарувај само во селектираните фајлови
        } else {
            filesToSearch = fs.readdirSync(REPORTS_PATH)
                .filter(file => file.endsWith('.xlsx') || file.endsWith('.csv')); // Ако нема селектирани, користи ги сите
        }

        console.log("📂 Пребарувам во фајловите:", filesToSearch);

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
            } else if (fileName.endsWith('.csv')) {
                let csvData = [];
                fs.createReadStream(filePath)
                    .pipe(csv())
                    .on('data', (row) => csvData.push(row))
                    .on('end', () => {
                        const filteredData = csvData.filter(row =>
                            Object.values(row).some(value => value.toString().toLowerCase().includes(query.toLowerCase()))
                        );

                        if (filteredData.length > 0) {
                            results.push({ fileName, data: filteredData });
                        }
                    });
            }
        }

        setTimeout(() => { res.json(results); }, 1000); // Дај му 1 секунда за асинхрона обработка
    } catch (error) {
        console.error('❌ Грешка при пребарување:', error);
        res.status(500).json({ error: 'Грешка при пребарување на податоците.' });
    }
});

const getAllFiles = (dirPath, arrayOfFiles) => {
    const files = fs.readdirSync(dirPath);
    arrayOfFiles = arrayOfFiles || [];

    files.forEach(file => {
        const fullPath = path.join(dirPath, file);
        if (fs.statSync(fullPath).isDirectory()) {
            arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
        } else if (file.endsWith('.xlsx') || file.endsWith('.csv')) {
            arrayOfFiles.push(fullPath.replace(REPORTS_PATH + "\\", ""));
        }
    });

    return arrayOfFiles;
};

const getFilesAndFolders = (dirPath) => {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    const files = [];
    const folders = [];

    entries.forEach(entry => {
        if (entry.isDirectory()) {
            folders.push(entry.name);
        } else if (entry.name.endsWith('.xlsx') || entry.name.endsWith('.csv')) {
            files.push(entry.name);
        }
    });

    return { files, folders };
};

app.get('/getFilesAndFolders', async (req, res) => {
    try {
        const { files, folders } = getFilesAndFolders(REPORTS_PATH);
        res.json({ files, folders });
    } catch (error) {
        console.error('❌ Грешка при вчитување на документи и папки:', error);
        res.status(500).json({ error: 'Грешка при вчитување на документи и папки.' });
    }
});


app.get('/getFiles', async (req, res) => {
    try {
        const files = fs.readdirSync(REPORTS_PATH)
            .filter(file => file.endsWith('.xlsx') || file.endsWith('.csv'));

        res.json(files);
    } catch (error) {
        console.error('❌ Грешка при вчитување на документи:', error);
        res.status(500).json({ error: 'Грешка при вчитување на документи.' });
    }
});


app.get('/details', async (req, res) => {
    try {
        const { fileName, query } = req.query;

        if (!fileName || !query) {
            return res.status(400).json({ error: "Недостасува име на фајлот или критериум за пребарување!" });
        }

        const filePath = path.join(REPORTS_PATH, fileName);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Фајлот не постои!' });
        }

        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });

        // 📌 Филтрирање на релевантните податоци
        const filteredData = sheetData.filter(row => 
            Object.values(row).some(value => value.toString().toLowerCase().includes(query.toLowerCase()))
        );

        res.json({ fileName, data: filteredData });
    } catch (error) {
        console.error("❌ Грешка при добивање на детали:", error);
        res.status(500).json({ error: "Грешка при добивање на детали!" });
    }
});


// API за приказ на сите податоци
app.get('/data', async (req, res) => {
    try {
        const reports = await readFilesFromDirectory(REPORTS_PATH);
        res.json(reports);
    } catch (error) {
        console.error('Грешка:', error);
        res.status(500).json({ error: 'Грешка при читање на податоците.' });
    }
});

// API за читање на логови
app.get('/logs', (req, res) => {
    fs.readFile(LOG_FILE_PATH, 'utf8', (err, data) => {
        if (err) {
            console.error("❌ Грешка при читање на логовите:", err);
            return res.status(500).json({ error: "Грешка при читање на логовите!" });
        }

        const logs = data.split("\n").filter(line => line.trim() !== "").map(line => {
            const parts = line.split(" - ");
            return {
                timestamp: parts[0],
                email: parts[1],
                action: parts[2],
                details: parts[3]
            };
        });

        res.json(logs);
    });
});

app.get('/history', async (req, res) => {
    try {
        const { fileName, rowIndex, columnName } = req.query;
        if (!fileName || rowIndex === undefined || !columnName) {
            return res.status(400).json({ error: "Недостасуваат параметри!" });
        }

        // 📌 Земаме ја историјата од базата
        const changes = await ChangeLog.find({ fileName, rowIndex, columnName }).sort({ timestamp: -1 });

        if (changes.length === 0) {
            console.log("⚠ Нема претходни измени за:", fileName, "Ред:", rowIndex, "Колона:", columnName);
        }

        res.json(changes);
    } catch (error) {
        console.error("❌ Грешка при добивање на историјата:", error);
        res.status(500).json({ error: "Грешка при добивање на историјата." });
    }
});


// API за пребарување историја
app.post('/history', async (req, res) => {
    try {
        const { query } = req.body;
        const historyData = await readFilesFromDirectory(HISTORY_PATH);

        const filteredResults = historyData.map(report => ({
            fileName: report.fileName,
            data: report.data.filter(row => 
                Object.values(row).some(value => value.toString().toLowerCase().includes(query.toLowerCase()))
            )
        })).filter(report => report.data.length > 0);

        res.json(filteredResults);
    } catch (error) {
        console.error('Грешка при пребарување на историја:', error);
        res.status(500).json({ error: 'Грешка при пребарување на историја.' });
    }
});

// Функција за автентикација преку Active Directory
function authenticateUser(email, password, callback) {
    const client = ldap.createClient({
        url: 'ldap://alkaloidad.local'
    });

    const username = email.split('@')[0]; // Извлекува "mnikolov" од "mnikolov@alkaloid.com.mk"
const domainUser = `alkaloidad\\${username}`;

    client.on('error', (err) => {
        console.error("❌ LDAP Client Error:", err.message);
        callback(false);
    });

    try {
        client.bind(domainUser, password, (err) => {
            if (err) {
                console.error("❌ Неуспешна автентикација:", err.message);
                callback(false);
            } else {
                console.log("✅ Успешна најава:", email);
                callback(true);
            }
            client.unbind();
        });
    } catch (error) {
        console.error("❌ Фатена грешка при LDAP поврзување:", error.message);
        callback(false);
    }
}

app.post('/login', (req, res) => {
    const { email, password } = req.body;

    authenticateUser(email, password, (isAuthenticated) => {
        if (isAuthenticated) {
            logActivity(email, "Најава", "Успешна најава");
            res.json({ success: true, message: 'Успешна најава!' });
        } else {
            logActivity(email, "Најава", "Неуспешна најава");
            res.status(401).json({ success: false, message: 'Неуспешна автентикација!' });
        }
    });
});

app.post('/edit', async (req, res) => {
    try {
        const { fileName, rowIndex, columnName, newValue, email } = req.body;

        if (!fileName || rowIndex === undefined || !columnName || newValue === undefined || !email) {
            return res.status(400).json({ error: "Недостасуваат податоци!" });
        }

        let filePath = path.join(REPORTS_PATH, fileName);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Фајлот не постои!' });
        }

        // 📌 Читање на Excel фајлот
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });

        if (!sheetData[rowIndex]) {
            return res.status(400).json({ error: "Редицата не постои!" });
        }

        const oldValue = sheetData[rowIndex][columnName];
        sheetData[rowIndex][columnName] = newValue;

        // 📌 Чување на историјата на измени
        await saveChangeLog(fileName, rowIndex, columnName, oldValue, newValue, email);

        // 📌 Запиши ги податоците назад во Excel
        workbook.Sheets[sheetName] = xlsx.utils.json_to_sheet(sheetData);
        xlsx.writeFile(filePath, workbook);

        console.log(`✅ Excel фајлот успешно ажуриран: ${fileName}`);
        res.json({ success: true, message: "Податоците се ажурирани!" });

    } catch (error) {
        console.error("❌ Грешка при зачувување на Excel:", error);
        res.status(500).json({ error: "Грешка при зачувување на Excel фајлот!" });
    }
});



// Старт на серверот
app.listen(PORT, () => {
    console.log(`Серверот е активиран на http://localhost:${PORT}`);
});