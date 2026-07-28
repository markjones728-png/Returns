// Ordered list of statuses in the returns workflow.
// The dashboard treats everything except the final status as "live"
// and the final status as "archived".
const STATUSES = [
  'Return Submitted',
  'Authorised for Collection',
  'In Transit',
  'At Returns Dept',
  'Awaiting RT Italy',
  'Awaiting Inspection by Returns',
  'Inspected - Out Of Warranty',
  'Inspected - Damaged',
  'Inspected - Warranty Replacement Authorised (RTA)',
  'Inspected - Warranty Replacement Authorised',
  'Report Sent',
  'Return Closed'
];

const CLOSED_STATUS = 'Return Closed';

// Statuses where a Manufacturer RMA Number box should be shown on the
// Update Status form (see return-detail.ejs).
const STATUSES_NEEDING_RMA_NUMBER = [
  'Inspected - Out Of Warranty',
  'Inspected - Damaged',
  'Inspected - Warranty Replacement Authorised (RTA)',
  'Inspected - Warranty Replacement Authorised'
];

// Statuses where a separate RTA RT Number box should also be shown -
// this is that manufacturer's own reference number, distinct from the
// general Manufacturer RMA Number above.
const STATUSES_NEEDING_RTA_NUMBER = [
  'Inspected - Warranty Replacement Authorised (RTA)'
];

// Colour used for each status pill in the UI
const STATUS_COLORS = {
  'Return Submitted': '#64748b',
  'Authorised for Collection': '#0284c7',
  'In Transit': '#2563eb',
  'At Returns Dept': '#7c3aed',
  'Awaiting RT Italy': '#9333ea',
  'Awaiting Inspection by Returns': '#c026d3',
  'Inspected - Out Of Warranty': '#ea580c',
  'Inspected - Damaged': '#b91c1c',
  'Inspected - Warranty Replacement Authorised (RTA)': '#059669',
  'Inspected - Warranty Replacement Authorised': '#0d9488',
  'Report Sent': '#0891b2',
  'Return Closed': '#334155'
};

// --- Options for the Roger Technology inspection/test form ---
const APPLICATION_TYPES = ['Residential', 'Commercial', 'Industrial', 'Other'];
const PRODUCT_TYPES = ['Sliding Gate', 'Swing Gate', 'Barrier', 'Bollard', 'Garage Door', 'Industrial Door', 'Other'];
const GUARANTEE_STATUSES = ['In Guarantee', 'Out of Guarantee', 'Unknown'];
const REPAIRABLE_OPTIONS = ['Repairable', 'Not Repairable', 'Unknown'];
const REQUEST_TYPES = ['Return to Roger Technology for Inspection', 'Request for Quote Only'];
const TEST_RESULTS = ['Pass', 'Fail', 'Partial / Further Work Needed'];

// Access Control Ltd / RT Automation's own details, as they appear on the
// Roger Technology "Request for Authorisation to Return Product for
// Inspection" form's Dealer Details section. These are always the same for
// every return, so they're hardcoded here rather than entered per-return.
const DEALER_DETAILS = {
  tradingName: 'RT Automation',
  operator: 'Returns Team',
  telephone: '01572 868 388',
  email: 'returns@rtautomation.co.uk'
};

module.exports = {
  STATUSES, CLOSED_STATUS, STATUS_COLORS, STATUSES_NEEDING_RMA_NUMBER, STATUSES_NEEDING_RTA_NUMBER,
  APPLICATION_TYPES, PRODUCT_TYPES, GUARANTEE_STATUSES,
  REPAIRABLE_OPTIONS, REQUEST_TYPES, TEST_RESULTS, DEALER_DETAILS
};
