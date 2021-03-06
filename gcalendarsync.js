// Script to synchronize a calendar to a spreadsheet and vice versa.
//
// See https://github.com/Davepar/gcalendarsync for instructions on setting this up.
//

// Set this value to match your calendar!!!
// Calendar ID can be found in the "Calendar Address" section of the Calendar Settings.
var calendarId = '<your-calendar-id>@group.calendar.google.com';

var titleRowMap = {
  'title': 'Title',
  'description': 'Description',
  'location': 'Location',
  'starttime': 'Start Time',
  'endtime': 'End Time',
  'guests': 'Guests',
  'id': 'Id'
};
var titleRowKeys = ['title', 'description', 'location', 'starttime', 'endtime', 'guests', 'id'];
var requiredFields = ['id', 'title', 'starttime', 'endtime'];

// This controls whether email invites are sent to guests when the event is created in the
// calendar. Note that any changes to the event will cause email invites to be resent.
var SEND_EMAIL_INVITES = false;

// Adds the custom menu to the active spreadsheet.
function onOpen() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var menuEntries = [
    {
      name: "Update from Calendar",
      functionName: "syncFromCalendar"
    }, {
      name: "Update to Calendar",
      functionName: "syncToCalendar"
    }
  ];
  spreadsheet.addMenu('Calendar Sync', menuEntries);
}

// Creates a mapping array between spreadsheet column and event field name
function createIdxMap(row) {
  var idxMap = [];
  for (var idx = 0; idx < row.length; idx++) {
    var fieldFromHdr = row[idx];
    for (var titleKey in titleRowMap) {
      if (titleRowMap[titleKey] == fieldFromHdr) {
        idxMap.push(titleKey);
        break;
      }
    }
    if (idxMap.length <= idx) {
      // Header field not in map, so add null
      idxMap.push(null);
    }
  }
  return idxMap;
}

// Converts a spreadsheet row into an object containing event-related fields
function reformatEvent(row, idxMap) {
  return row.reduce(function(event, value, idx) {
    if (idxMap[idx] != null) {
      event[idxMap[idx]] = value;
    }
    return event;
  }, {});
}

// Converts a calendar event to a psuedo-sheet event.
function convertCalEvent(calEvent) {
  convertedEvent = {
    'id': calEvent.getId(),
    'title': calEvent.getTitle(),
    'description': calEvent.getDescription(),
    'location': calEvent.getLocation(),
    'guests': calEvent.getGuestList().map(function(x) {return x.getEmail();}).join(',')
  };
  if (calEvent.isAllDayEvent()) {
    convertedEvent.starttime = calEvent.getAllDayStartDate();
    var endtime = calEvent.getAllDayEndDate();
    if (endtime - convertedEvent.starttime === 24 * 3600 * 1000) {
      convertedEvent.endtime = '';
    } else {
      convertedEvent.endtime = endtime;
      if (endtime.getHours() === 0 && endtime.getMinutes() == 0) {
        convertedEvent.endtime.setSeconds(endtime.getSeconds() - 1);
      }
    }
  } else {
    convertedEvent.starttime = calEvent.getStartTime();
    convertedEvent.endtime = calEvent.getEndTime();
  }
  return convertedEvent;
}

// Converts calendar event into spreadsheet data row
function calEventToSheet(calEvent, idxMap, dataRow) {
  convertedEvent = convertCalEvent(calEvent);

  for (var idx = 0; idx < idxMap.length; idx++) {
    if (idxMap[idx] !== null) {
      dataRow[idx] = convertedEvent[idxMap[idx]];
    }
  }
}

// Returns empty string or time in milliseconds for Date object
function getEndTime(ev) {
  return ev.endtime === '' ? '' : ev.endtime.getTime();
}

// Tests whether calendar event matches spreadsheet event
function eventMatches(cev, sev) {
  var convertedCalEvent = convertCalEvent(cev);
  return convertedCalEvent.title == sev.title &&
    convertedCalEvent.description == sev.description &&
      convertedCalEvent.location == sev.location &&
        convertedCalEvent.starttime == sev.starttime &&
          getEndTime(convertedCalEvent) === getEndTime(sev) &&
            convertedCalEvent.guests == sev.guests;
}

// Determine whether required fields are missing
function fieldsMissing(idxMap) {
  return requiredFields.some(function(val) {
    return idxMap.indexOf(val) < 0;
  });
}

// Set up formats and hide ID column for empty spreadsheet
function setUpSheet(sheet, fieldKeys) {
  sheet.getRange(1, fieldKeys.indexOf('starttime') + 1, 999).setNumberFormat('M/d/yyyy H:mm');
  sheet.getRange(1, fieldKeys.indexOf('endtime') + 1, 999).setNumberFormat('M/d/yyyy H:mm');
  sheet.hideColumns(fieldKeys.indexOf('id') + 1);
}

// Display error alert
function errorAlert(msg, evt, ridx) {
  var ui = SpreadsheetApp.getUi();
  if (evt) {
    ui.alert('Skipping row: ' + msg + ' in event "' + evt.title + '", row ' + (ridx + 1));
  } else {
    ui.alert(msg);
  }
}

// Synchronize from calendar to spreadsheet.
function syncFromCalendar() {
  // Get calendar and events
  var calendar = CalendarApp.getCalendarById(calendarId);
  var calEvents = calendar.getEvents(new Date('1/1/1970'), new Date('1/1/2030'));

  // Get spreadsheet and data
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getActiveSheet();
  var range = sheet.getDataRange();
  var data = range.getValues();
  var eventFound = new Array(data.length);

  // Check if spreadsheet is empty and add a title row
  var titleRow = [];
  for (var idx = 0; idx < titleRowKeys.length; idx++) {
    titleRow.push(titleRowMap[titleRowKeys[idx]]);
  }
  if (data.length < 1) {
    data.push(titleRow);
    range = sheet.getRange(1, 1, data.length, data[0].length);
    range.setValues(data);
    setUpSheet(sheet, titleRowKeys);
  }

  if (data.length == 1 && data[0].length == 1 && data[0][0] === '') {
    data[0] = titleRow;
    range = sheet.getRange(1, 1, data.length, data[0].length);
    range.setValues(data);
    setUpSheet(sheet, titleRowKeys);
  }

  // Map spreadsheet headers to indices
  var idxMap = createIdxMap(data[0]);
  var idIdx = idxMap.indexOf('id');

  // Verify header has all required fields
  if (fieldsMissing(idxMap)) {
    var reqFieldNames = requiredFields.map(function(x) {return titleRowMap[x];}).join(', ');
    errorAlert('Spreadsheet must have ' + reqFieldNames + ' columns');
    return;
  }

  // Array of IDs in the spreadsheet
  var sheetEventIds = data.slice(1).map(function(row) {return row[idIdx];});

  // Loop through calendar events
  for (var cidx = 0; cidx < calEvents.length; cidx++) {
    var calEvent = calEvents[cidx];
    var calEventId = calEvent.getId();

    var ridx = sheetEventIds.indexOf(calEventId) + 1;
    if (ridx < 1) {
      // Event not found, create it
      ridx = data.length;
      var newRow = [];
      var rowSize = idxMap.length;
      while (rowSize--) newRow.push('');
      data.push(newRow);
    } else {
      eventFound[ridx] = true;
    }
    // Update event in spreadsheet data
    calEventToSheet(calEvent, idxMap, data[ridx]);
  }

  // Remove any data rows not found in the calendar
  var rowsDeleted = 0;
  for (var idx = eventFound.length - 1; idx > 0; idx--) {
    if (!eventFound[idx]) {
      data.splice(idx, 1);
      rowsDeleted++;
    }
  }

  // Save spreadsheet changes
  range = sheet.getRange(1, 1, data.length, data[0].length);
  range.setValues(data);
  if (rowsDeleted > 0) {
    sheet.deleteRows(data.length + 1, rowsDeleted);
  }
}

// Synchronize from spreadsheet to calendar.
function syncToCalendar() {
  // Get calendar and events
  var calendar = CalendarApp.getCalendarById(calendarId);
  if (!calendar) {
    errorAlert('Cannot find calendar. Check instructions for set up.');
  }
  var calEvents = calendar.getEvents(new Date('1/1/1970'), new Date('1/1/2030'));
  var calEventIds = calEvents.map(function(val) {return val.getId()});

  // Get spreadsheet and data
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getActiveSheet();
  var range = sheet.getDataRange();
  var data = range.getValues();
  if (data.length < 2) {
    errorAlert('Spreadsheet must have a title row and at least one data row');
    return;
  }

  // Map headers to indices
  var idxMap = createIdxMap(data[0]);
  var idIdx = idxMap.indexOf('id');
  var idRange = range.offset(0, idIdx, data.length, 1);
  var idData = idRange.getValues()

  // Verify header has all required fields
  if (fieldsMissing(idxMap)) {
    var reqFieldNames = requiredFields.map(function(x) {return titleRowMap[x];}).join(', ');
    errorAlert('Spreadsheet must have ' + reqFieldNames + ' columns');
    return;
  }

  // Loop through spreadsheet rows
  var numAdds = 0;
  var numUpdated = 0;
  var changesMade = false;
  for (var ridx = 1; ridx < data.length; ridx++) {
    var sheetEvent = reformatEvent(data[ridx], idxMap);

    // Do some error checking first
    if (!sheetEvent.title) {
      errorAlert('must have title', sheetEvent, ridx);
      continue;
    }
    if (!(sheetEvent.starttime instanceof Date)) {
      errorAlert('start time must be a date/time', sheetEvent, ridx);
      continue;
    }
    if (sheetEvent.endtime !== '') {
      if (!(sheetEvent.endtime instanceof Date)) {
        errorAlert('end time must be empty or a date/time', sheetEvent, ridx);
        continue;
      }
      if (sheetEvent.endtime < sheetEvent.starttime) {
        errorAlert('end time must be after start time for event', sheetEvent, ridx);
        continue;
      }
    }

    // Determine if spreadsheet event is already in calendar and matches
    var addEvent = true;
    if (sheetEvent.id) {
      var eventIdx = calEventIds.indexOf(sheetEvent.id);
      if (eventIdx >= 0) {
        calEventIds[eventIdx] = null;  // Prevents removing event below
        var calEvent = calEvents[eventIdx];
        if (eventMatches(calEvent, sheetEvent)) {
          addEvent = false;
        } else {
          // Delete and re-create event. It's easier than updating in place.
          calEvent.deleteEvent();
          numUpdated++;
        }
      }
    }
    if (addEvent) {
      var newEvent;
      sheetEvent.sendInvites = SEND_EMAIL_INVITES;
      if (sheetEvent.endtime === '') {
        newEvent = calendar.createAllDayEvent(sheetEvent.title, sheetEvent.starttime, sheetEvent);
      } else {
        newEvent = calendar.createEvent(sheetEvent.title, sheetEvent.starttime, sheetEvent.endtime, sheetEvent);
      }
      // Put event ID back into spreadsheet
      idData[ridx][0] = newEvent.getId();
      changesMade = true;

      // Updating too many calendar events in a short time interval triggers an error. Still experimenting with
      // the exact values to use here, but this works for updating about 40 events.
      numAdds++;
      if (numAdds > 10) {
        Utilities.sleep(75);
      }
    }
  }

  // Save spreadsheet changes
  if (changesMade) {
    idRange.setValues(idData);
  }

  // Remove any calendar events not found in the spreadsheet
  var numToRemove = calEventIds.reduce(function(prevVal, curVal) {
    if (curVal !== null) {
      prevVal++;
    }
    return prevVal;
  }, 0);
  if (numToRemove > 0) {
    var ui = SpreadsheetApp.getUi();
    var response = ui.Button.YES;
    if (numToRemove > numUpdated) {
      response = ui.alert('Delete ' + numToRemove + ' calendar event(s) not found in spreadsheet?',
          ui.ButtonSet.YES_NO);
    }
    if (response == ui.Button.YES) {
      calEventIds.forEach(function(id, idx) {
        if (id != null) {
          calEvents[idx].deleteEvent();
          Utilities.sleep(20);
        }
      });
    }
  }
}
