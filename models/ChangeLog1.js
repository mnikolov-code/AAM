const mongoose = require('mongoose');

const changeLogSchema = new mongoose.Schema({
  fileName: String,
  rowIndex: Number,
  columnName: String,
  oldValue: String,
  newValue: String,
  modifiedBy: String,
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.models.ChangeLog || mongoose.model('ChangeLog', changeLogSchema);