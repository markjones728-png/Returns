const { CLOSED_STATUS } = require('./constants');

// The Dashboard groups every return into one of these stages instead of the
// old two-tab Live/Archived split, so staff can see at a glance how many
// returns are sat at each point in the process. This is also the order the
// tabs appear in on the Dashboard, matching the order a return normally
// moves through - see stageForReturn() below for how a return is assigned
// to one of them.
const DASHBOARD_STAGES = [
  { key: 'new_return', label: 'New Return' },
  { key: 'awaiting_collection', label: 'Awaiting Collection' },
  { key: 'in_transit', label: 'In Transit' },
  { key: 'at_returns', label: 'At Returns' },
  { key: 'awaiting_manufacturer', label: 'Awaiting Manufacturer' },
  { key: 'warranty_approved', label: 'Warranty Approved' },
  { key: 'out_of_warranty', label: 'Out of Warranty' },
  { key: 'damaged', label: 'Damaged' },
  { key: 'no_fault_found', label: 'No Fault Found' },
  { key: 'returned', label: 'Returned' },
  { key: 'closed', label: 'Closed' }
];

// Works out which of the stages above a given return currently belongs
// under. Checked in this order:
//   1. Closed always wins, whatever else is true.
//   2. The "Manufacturer Confirmed Warranty Repair" tick (RT Italy Warranty
//      Claim section) puts it under Warranty Approved, and keeps it there
//      even after the report's been sent - it only leaves once closed.
//   3. Otherwise its plain status decides it. Awaiting RT Italy and
//      Awaiting Inspection by Returns are grouped together as "Awaiting
//      Manufacturer". Everything left over - Inspected - Warranty
//      Replacement Authorised (RTA)/without RTA (before that tick is set)
//      and Report Sent - falls under "Returned", since the outcome's been
//      reached and/or the report's gone out, but it isn't a manufacturer-
//      confirmed warranty job and it isn't closed yet either.
function stageForReturn(r) {
  if (r.status === CLOSED_STATUS) return 'closed';
  if (r.rt_italy_manufacturer_confirmed) return 'warranty_approved';

  switch (r.status) {
    case 'Return Submitted': return 'new_return';
    case 'Authorised for Collection': return 'awaiting_collection';
    case 'In Transit': return 'in_transit';
    case 'At Returns Dept': return 'at_returns';
    case 'Awaiting RT Italy':
    case 'Awaiting Inspection by Returns':
      return 'awaiting_manufacturer';
    case 'Inspected - Out Of Warranty': return 'out_of_warranty';
    case 'Inspected - Damaged': return 'damaged';
    case 'Inspected - No Fault Found': return 'no_fault_found';
    default:
      return 'returned';
  }
}

module.exports = { DASHBOARD_STAGES, stageForReturn };
