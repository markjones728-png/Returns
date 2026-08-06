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
  'Inspected - No Fault Found',
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
  'Inspected - No Fault Found': '#65a30d',
  'Inspected - Warranty Replacement Authorised (RTA)': '#059669',
  'Inspected - Warranty Replacement Authorised': '#0d9488',
  'Report Sent': '#0891b2',
  'Return Closed': '#334155'
};

// --- Options for the Roger Technology inspection/test form ---
const APPLICATION_TYPES = ['Residential', 'Commercial', 'Industrial', 'Other'];
const PRODUCT_TYPES = ['Sliding Gate', 'Swing Gate', 'Barrier', 'Bollard', 'Garage Door', 'Industrial Door', 'Other'];
// 'Intermittent Fault Found' and 'Unable to Test' were added to match the
// Roger Technology Warranty Repair Return Form's Bench Test Result options -
// the original three are kept as-is so existing saved returns still show
// their selection correctly.
const TEST_RESULTS = ['Pass', 'Fail', 'Partial / Further Work Needed', 'Intermittent Fault Found', 'Unable to Test'];

// Options for the "Received Condition" check done when the item first
// arrives at the returns department - internal/staff use only, see below.
const RECEIVED_PARTS_STATUSES = ['All Parts Present', 'Parts Missing'];

// --- Options added to match the Roger Technology "Warranty Repair Return
// --- Form" that the returns department fills in on paper today. Only the
// --- fields NOT already captured from the customer's own submission are
// --- added here (see return-detail.ejs comments for the full mapping).
const RT_PRODUCT_TYPES = [
  'Ram Actuator (Swing)', 'Articulated Arm', 'Underground Motor',
  'Sliding Gate Motor', 'Control Board', 'Accessory: Photocells / Intercom / Remote / Other'
];
const INSTALLATION_AGE_OPTIONS = ['Less than 1 month', '1-6 months', '6-12 months', '1-2 years', 'Out of warranty'];
const FAULT_OCCURRENCE_OPTIONS = ['Constantly', 'Intermittently', 'Weather-dependent (Rain / Cold / Heat)', 'Upon initial power-up'];
const ARRIVAL_CONDITION_FLAGS = ['No visible damage', 'Visible damage', 'Missing parts', 'Signs of water ingress'];
const WARRANTY_VERDICT_OPTIONS = ['Approved Warranty', 'Rejected Warranty'];
const REJECTION_REASONS = [
  'Power surge / lightning damage',
  'Water ingress due to poor sealing during installation',
  'Mechanical overload - gate too heavy or unbalanced for motor specification',
  'Pest damage causing circuit board short',
  'Physical damage / wear and tear',
  'Other'
];
const ACTION_TAKEN_OPTIONS = ['Replaced under warranty', 'Repaired', 'Scrapped', 'Returned to customer as-is'];

// Root cause of the fault, picked by staff as part of the Warranty
// Determination step - used by the Reports page to spot trends by
// equipment type (see routes/returns.js's /reports route).
const FAULT_CATEGORIES = [
  'User Error', 'Manufacturing Defect', 'Misuse', 'Installation Error',
  'No Fault Found', 'Transit Damage', 'Wear and Tear'
];

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
  APPLICATION_TYPES, PRODUCT_TYPES,
  TEST_RESULTS, RECEIVED_PARTS_STATUSES, DEALER_DETAILS,
  RT_PRODUCT_TYPES, INSTALLATION_AGE_OPTIONS, FAULT_OCCURRENCE_OPTIONS, ARRIVAL_CONDITION_FLAGS,
  WARRANTY_VERDICT_OPTIONS, REJECTION_REASONS, ACTION_TAKEN_OPTIONS, FAULT_CATEGORIES
};
