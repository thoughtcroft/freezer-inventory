const ActionTypes = {
  ADD: "ADD",
  GET: "GET",
  REMOVE: "REMOVE"
};

const MIN_ITEM_ID = 101;

const API_KEY = getScriptSecret_("API_KEY");
const DATE_FORMAT = getScriptSecret_("DATE_FORMAT");
const DIGEST_EMAIL = getScriptSecret_("DIGEST_EMAIL");
const DIGEST_MAX_AGE = getScriptSecret_("DIGEST_MAX_AGE");
const SHEET_ID = getScriptSecret_("SHEET_ID");
const TIME_ZONE = Session.getScriptTimeZone();

const ResponseTypes = {
  OK: "OK",
  ERROR: "ERROR"
};

function doGet(e) {
  console.info(`HTTP GET request received: ${e}`);
  return createErrorResponse("Invalid request")
}

function doPost(e) {
  console.info(`HTTP POST request received: ${e}`);
  let responseMsg = "";
  
  // first check the request comes from valid user
  if(!requestIsValid_(e)) {
    console.error("Invalid request received");
    return createErrorResponse("Invalid request");
  };

  // check we have a valid action
  let action = getRequestData_(e, "action");
  if(!Object.values(ActionTypes).includes(action)) {
    console.error(`Invalid action ${action} received`);
    return createErrorResponse("Invalid action");
  };

  if(action === ActionTypes.ADD) {
    let desc = getRequestData_(e, "desc");
    let weight = getRequestData_(e, "weight") || "";

    if(!desc) {
      return createErrorResponse("Invalid data - no description provided");
    };
    
    // add item will return the ID of the newly added item
    let newID = addItem(desc, weight);

    if(!newID) {
      return createErrorResponse("Error: ITEM NOT ADDED");
    };
    responseMsg = `Item ${newID} added`;
  };

  if(action === ActionTypes.REMOVE || action === ActionTypes.GET) {
    let itemID = getRequestData_(e, "id");
    if(!itemID) {
      return createErrorResponse("Invalid data - no id provided");
    };

    let getResult = getItem(itemID);
    if(!getResult) {
      return createErrorResponse(`Error: ITEM ${itemID} NOT FOUND`);
    };

    if(action === ActionTypes.REMOVE) {
      if(!deleteItem(itemID)) {
        return createErrorResponse(`Error: ITEM ${itemID} COULD NOT BE REMOVED`);
      };
      responseMsg = `Item ${itemID} removed`;
    }; 

    if(action === ActionTypes.GET) {
      responseMsg = `Item ${getResult.id}: ${getResult.desc}`;
        if(getResult.weight) {
          responseMsg += ` (${getResult.weight})`;
      };    
    };
  };

  console.log(responseMsg);
  return createResponse(responseMsg);
}

function createGenericResponse(responseType, responseMsg, responseData) {
  let content = {
      type: responseType,
      message: responseMsg,
      data: responseData || ""
  };
  return ContentService.createTextOutput(JSON.stringify(content)).setMimeType(ContentService.MimeType.JSON); 
}

function createResponse(responseMsg, responseData) {
  return createGenericResponse(ResponseTypes.OK, responseMsg, responseData);
}

function createErrorResponse(errorMsg) {
  return createGenericResponse(ResponseTypes.ERROR, errorMsg, null);
}

function addItem(itemDesc, weight) {
  let inventorySheet = getDataSheet_();

  // get today's date
  let formattedDate = Utilities.formatDate(
    new Date(), TIME_ZONE, DATE_FORMAT);

  // calculate a new ID
  let newID = getFirstAvailableID();

  if(newID < MIN_ITEM_ID) {
    // something went wrong
    return null;
  };

  // add the new row with the data and formula for computing age in days
  inventorySheet.appendRow([newID, itemDesc, weight, formattedDate]);
  let lastRow = inventorySheet.getLastRow();    
  let lastColumn = inventorySheet.getLastColumn();
  let lastCell = inventorySheet.getRange(lastRow, lastColumn);
  lastCell.setValue("=TODAY()-R[0]C[-1]");
  return newID;
}

function deleteItem(itemID) {
  let inventorySheet = getDataSheet_();
  let lastRow = inventorySheet.getLastRow();

  // look for a row with a matching ID
  let deleted = false;

  for (let i = lastRow; i > 0; i--) {
    let range = inventorySheet.getRange(i,1); 
    let data = range.getValue();
    if (data == itemID) {
      console.log(data);
      inventorySheet.deleteRow(i);
      deleted = true;
    };
  };

  return deleted;
}

function getItem(itemID) {
  let inventorySheet = getDataSheet_();
  let lastRow = inventorySheet.getLastRow();

  // look for a row with a matching ID
  let matched = -1;

  let range = inventorySheet.getRange(1, 1, lastRow, 5);
  let values = range.getValues();

  for(var row in values) {
    if(values[row][0] == itemID) {
      // Found it
      return { id: itemID, desc: values[row][1], weight: values[row][2] };
    };
  };

  // didn't find it
  return null;
}

function getFirstAvailableID() {
  let inventorySheet = getDataSheet_();

  // Our IDs are in column 1
  let column = 1; 
  let idsInUse = inventorySheet.getRange(2, column, 
    inventorySheet.getLastRow()).getValues().flat();

  let available = false;
  let newID = -1;
 
  // walk through looking for the first ID that isn't in use
  for(let i = MIN_ITEM_ID; !available; i++) {
    newID = i;
    available = !idsInUse.includes(i);
  };

  console.log(`First available id is ${newID}`);
  return newID;
}

function sendOldItemDigest() {
  let oldItems = checkForOldItems_(DIGEST_MAX_AGE);
  if(oldItems && oldItems.length > 0) {
    var template = HtmlService.createTemplateFromFile('emailTemplate');
    template.oldItems = oldItems.sort((a, b) => b.age - a.age );
    template.timeZone = TIME_ZONE;
    template.dateFormat = DATE_FORMAT;
    let content = template.evaluate().getContent();

    MailApp.sendEmail({
      to: DIGEST_EMAIL,
      subject: "Freezer Inventory Notification",
      htmlBody: content
    });
  };
}

function checkForOldItems_(age) {
  let inventorySheet = getDataSheet_();
  let lastRow = inventorySheet.getLastRow();

  // look for items older than the given age
  let range = inventorySheet.getRange(1, 1, lastRow, 5);
  let values = range.getValues();

  let oldItems = [];
  for(var row in values) {
    let thisItem = {
      id: values[row][0], 
      desc: values[row][1], 
      weight: values[row][2], 
      added: values[row][3], 
      age: values[row][4]
    };

    if(thisItem.age > age) {
      oldItems.push(thisItem);
    };
  };
  console.log(oldItems);
  return oldItems;
}

function getRequestData_(e, paramName) {
  let value = null;
  try {
    let data = JSON.parse(e.postData.contents);
    return data[paramName];
  } catch {
    console.log(`Parameter ${paramName} not found!`);
  };
  return value;
}

function getDataSheet_() {
  return SpreadsheetApp
    .openById(SHEET_ID)
    .getSheetByName("Freezer");
}

function requestIsValid_(e) {
  // make sure that only trusted users can access this sheet
  let key = getRequestData_(e, "key");
  return key === API_KEY;
}

function getScriptSecret_(key) {
  let secret = PropertiesService.getScriptProperties().getProperty(key)
  if (!secret) throw Error(`Secret ${key} is empty`)
  return secret
}
