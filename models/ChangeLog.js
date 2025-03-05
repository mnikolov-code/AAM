const mongoose = require('mongoose');

const ChangeLogSchema = new mongoose.Schema({
    fileName: String,
    rowIndex: Number,
    columnName: String,
    oldValue: String,
    newValue: String,
    modifiedBy: String
});

// 📌 Додавање на индекс за побрзо пребарување
ChangeLogSchema.index({ fileName: 1, columnName: 1 });

module.exports = mongoose.model('ChangeLog', ChangeLogSchema);
