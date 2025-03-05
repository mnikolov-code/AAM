const express = require('express');
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const xlsx = require('xlsx');
const cron = require('node-cron');
const fsExtra = require('fs-extra');

const app = express();
const PORT = 3000;

const FILES_LOCATION = '\\\\srvaitalkam\\Reporti';
const LOG_FILE_PATH = path.join(FILES_LOCATION, 'log.json');
const SOURCE_FOLDER = '\\\\srvaitalkam\\Reporti';
const DESTINATION_FOLDER = '\\\\srvaitalkam\\Reporti\\Martin';

app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

function generateUniqueFilename(destination, fileName) {
    const ext = path.extname(fileName);
    const baseName = path.basename(fileName, ext);
    let counter = 1;
    let newFileName = fileName;

    while (fs.existsSync(path.join(destination, newFileName))) {
        newFileName = `${baseName}_${counter}${ext}`;
        counter++;
    }

    return newFileName;
}

function logSearch(factoryNumber, action) {
    console.log(`Започнува логирање за фабрички број: ${factoryNumber}, акција: ${action}`);
    const currentDate = new Date();
    const date = currentDate.toISOString().split('T')[0];
    const time = currentDate.toTimeString().split(' ')[0];

    const newLog = { factoryNumber, date, time, action };

    let logs = [];
    if (fs.existsSync(LOG_FILE_PATH)) {
        const existingLogs = fs.readFileSync(LOG_FILE_PATH, 'utf8');
        logs = JSON.parse(existingLogs);
    }

    logs.push(newLog);
    fs.writeFileSync(LOG_FILE_PATH, JSON.stringify(logs, null, 2), 'utf8');
    console.log('Запишано успешно!');
}

app.post('/search', (req, res) => {
    const query = req.body.query.toLowerCase();
    const inventoryMode = req.body.inventoryMode;
    const results = [];

    logSearch(query, 'Барај');

    fs.readdir(FILES_LOCATION, (err, files) => {
        if (err) {
            return res.status(500).json({ error: 'Cannot access files' });
        }

        files.forEach((filename) => {
            if (filename.startsWith('~$')) {
                return;
            }

            const filePath = path.join(FILES_LOCATION, filename);

            if (filename.endsWith('.csv')) {
                console.log('Читање на CSV:', filename);
                const fileContent = fs.readFileSync(filePath, 'utf8');
                Papa.parse(fileContent, {
                    header: true,
                    complete: (parsedData) => {
                        let filteredData;
                        if (inventoryMode) {
                            filteredData = parsedData.data.filter((row) =>
                                Object.values(row).some((val) => String(val) === query)
                            );
                        } else {
                            filteredData = parsedData.data.filter((row) =>
                                Object.values(row).some((val) => String(val).toLowerCase().includes(query))
                            );
                        }

                        if (filteredData.length > 0) {
                            results.push({ name: filename, data: filteredData });
                        }
                    },
                });
            } else if (filename.endsWith('.xlsx')) {
                console.log('Читање на Excel:', filename);
                const workbook = xlsx.readFile(filePath);
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];
                const jsonData = xlsx.utils.sheet_to_json(sheet);

                let filteredData;
                if (inventoryMode) {
                    filteredData = jsonData.filter((row) =>
                        Object.values(row).some((val) => String(val) === query)
                    );
                } else {
                    filteredData = jsonData.filter((row) =>
                        Object.values(row).some((val) => String(val).toLowerCase().includes(query))
                    );
                }

                if (filteredData.length > 0) {
                    results.push({ name: filename, data: filteredData });
                }
            }
        });

        setTimeout(() => {
            res.json(results);
        }, 500);
    });
});

app.post('/log', (req, res) => {
    const { factoryNumber, action } = req.body;
    logSearch(factoryNumber, action);
    res.json({ success: true });
});

app.post('/save', (req, res) => {
    const { filename, data } = req.body;

    if (!filename) {
        return res.status(400).json({ error: 'Името на фајлот не е дадено.' });
    }

    const filePath = path.join(FILES_LOCATION, filename);

    if (filename.endsWith('.csv')) {
        const csvContent = Papa.unparse(data);

        fs.writeFile(filePath, csvContent, (err) => {
            if (err) {
                console.error('Грешка при зачувување на CSV:', err);
                return res.status(500).json({ error: 'Грешка при зачувување на податоците.' });
            }
            res.status(200).send('Податоците успешно се зачувани во CSV!');
        });
    } else if (filename.endsWith('.xlsx')) {
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const newSheet = xlsx.utils.json_to_sheet(data);

        workbook.Sheets[sheetName] = newSheet;

        xlsx.writeFile(workbook, filePath);
        res.status(200).send('Податоците успешно се зачувани во Excel!');
    } else {
        res.status(400).json({ error: 'Невалиден тип на фајл.' });
    }
});

app.post('/edit', (req, res) => {
    const { factoryNumber } = req.body;
    logSearch(factoryNumber, 'Edit');
    res.json({ success: true });
});

const getLastCopiedFileData = (column, value) => {
    return new Promise((resolve, reject) => {
        fs.readdir(DESTINATION_FOLDER, (err, files) => {
            if (err) {
                return reject('Cannot access destination folder');
            }

            const filteredFiles = files.filter(file => !file.startsWith('~$') && !file.startsWith('.'));

            if (filteredFiles.length === 0) {
                return reject('No copied files found');
            }

            const latestFile = filteredFiles.reduce((latest, file) => {
                const currentFile = path.join(DESTINATION_FOLDER, file);
                const currentStat = fs.statSync(currentFile);

                if (!latest || currentStat.mtime > latest.mtime) {
                    return { fileName: file, mtime: currentStat.mtime, filePath: currentFile };
                }

                return latest;
            }, null);

            if (latestFile.fileName.endsWith('.csv')) {
                const fileContent = fs.readFileSync(latestFile.filePath, 'utf8');
                const parsedData = Papa.parse(fileContent, { header: true });

                const matchedRow = parsedData.data.find(row => String(row[column]) === value);

                if (matchedRow) {
                    resolve(matchedRow[column]);
                } else {
                    reject('No matching row found');
                }
            } else if (latestFile.fileName.endsWith('.xlsx')) {
                const workbook = xlsx.readFile(latestFile.filePath);
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];
                const jsonData = xlsx.utils.sheet_to_json(sheet);

                const matchedRow = jsonData.find(row => String(row[column]) === value);

                if (matchedRow) {
                    resolve(matchedRow[column]);
                } else {
                    reject('No matching row found');
                }
            } else {
                reject('Unknown file type');
            }
        });
    });
};

app.get('/latest-cell-data', (req, res) => {
    const { column, value } = req.query;

    getLastCopiedFileData(column, value)
        .then(data => {
            res.json({ column: column, value: data });
        })
        .catch(err => {
            console.error(err);
            res.status(404).json({ message: 'Не се пронајдени податоци за последниот копиран фајл.' });
        });
});

app.get('/history', (req, res) => {
    const { column, value } = req.query;

    console.log(`Барање за колона: ${column}, вредност: ${value}`);

    // Читај ги сите фајлови во фолдерот
    const allFiles = fs.readdirSync(DESTINATION_FOLDER);

    let historyData = [];

    allFiles.forEach((fileName) => {
        const filePath = path.join(DESTINATION_FOLDER, fileName);
        console.log(`Читање на фајлот: ${filePath}`);

        if (fileName.endsWith('.csv')) {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const parsedData = Papa.parse(fileContent, { header: true });

            console.log(`Пронајдени редови во CSV: ${parsedData.data.length}`);

            // Проверувај за дадената колона и вредност во секој ред
            const columnData = parsedData.data
                .filter(row => 
                    row[column] && 
                    row[column].toString().toLowerCase().includes(value.toString().toLowerCase()) // Барање на слични вредности
                )
                .map(row => ({
                    fileName, // Додај го името на фајлот во резултатот
                    value: row[column] || '',
                    modifiedTime: fs.statSync(filePath).mtime
                }));

            historyData = historyData.concat(columnData);
        } else if (fileName.endsWith('.xlsx')) {
            const workbook = xlsx.readFile(filePath);
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const jsonData = xlsx.utils.sheet_to_json(sheet);

            console.log(`Пронајдени редови во Excel: ${jsonData.length}`);

            // Проверувај за дадената колона и вредност во секој ред
            const columnData = jsonData
                .filter(row => 
                    row[column] && 
                    row[column].toString().toLowerCase().includes(value.toString().toLowerCase()) // Барање на слични вредности
                )
                .map(row => ({
                    fileName, // Додај го името на фајлот во резултатот
                    value: row[column] || '',
                    modifiedTime: fs.statSync(filePath).mtime
                }));

            historyData = historyData.concat(columnData);
        }
    });

    console.log(`Пронајдени податоци за историја: ${historyData.length}`);

    if (historyData.length === 0) {
        return res.status(404).json({ message: 'Нема пронајдени податоци со дадената вредност.' });
    }

    historyData.sort((a, b) => b.modifiedTime - a.modifiedTime);
    console.log(`Податоците за историјата што ќе се испратат на клиентот: ${JSON.stringify(historyData)}`);

    res.json(historyData);
});





app.get('/latest-copy', (req, res) => {
    fs.readdir(DESTINATION_FOLDER, (err, files) => {
        if (err) {
            return res.status(500).json({ error: 'Cannot access destination folder' });
        }

        const filteredFiles = files.filter(file => !file.startsWith('~$') && !file.startsWith('.'));

        if (filteredFiles.length === 0) {
            return res.status(404).json({ message: 'Нема пронајдени копирани фајлови.' });
        }

        const latestFile = filteredFiles.reduce((latest, file) => {
            const currentFile = path.join(DESTINATION_FOLDER, file);
            const currentStat = fs.statSync(currentFile);

            if (!latest || currentStat.mtime > latest.mtime) {
                return { fileName: file, mtime: currentStat.mtime, filePath: currentFile };
            }

            return latest;
        }, null);

        if (latestFile.fileName.endsWith('.csv')) {
            const fileContent = fs.readFileSync(latestFile.filePath, 'utf8');
            const parsedData = Papa.parse(fileContent, { header: true });

            res.json({
                fileName: latestFile.fileName,
                modifiedTime: latestFile.mtime,
                data: parsedData.data[0]
            });
        } else if (latestFile.fileName.endsWith('.xlsx')) {
            const workbook = xlsx.readFile(latestFile.filePath);
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const jsonData = xlsx.utils.sheet_to_json(sheet);

            res.json({
                fileName: latestFile.fileName,
                modifiedTime: latestFile.mtime,
                data: jsonData[0]
            });
        } else {
            res.json({
                fileName: latestFile.fileName,
                modifiedTime: latestFile.mtime,
                data: null
            });
        }
    });
});

function copyFiles() {
    console.log('Започнува копирањето на фајлови...');
    fs.readdir(SOURCE_FOLDER, (err, files) => {
        if (err) {
            return console.error('Грешка при читање на изворниот фолдер:', err);
        }

        files.forEach((file) => {
            const sourcePath = path.join(SOURCE_FOLDER, file);
            const destinationPath = path.join(DESTINATION_FOLDER, file);

            const uniqueFileName = generateUniqueFilename(DESTINATION_FOLDER, file);

            fs.copyFile(sourcePath, path.join(DESTINATION_FOLDER, uniqueFileName), (err) => {
                if (err) {
                    console.error('Грешка при копирање:', err);
                } else {
                    console.log(`Фајлот ${file} е успешно копиран како ${uniqueFileName}`);
                }
            });
        });
    });
}

cron.schedule('0 2 * * *', () => {
    console.log('Започнување на задача во 02:00');
    copyFiles();
}, {
    timezone: "Europe/Skopje"
});

console.log('Автоматската задача е поставена и активна.');

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

