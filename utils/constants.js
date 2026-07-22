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
  'Inspected',
  'To Be Returned to Customer',
  'Warranty Replacement Authorised',
  'Return Closed'
];

const CLOSED_STATUS = 'Return Closed';

// Colour used for each status pill in the UI
const STATUS_COLORS = {
  'Return Submitted': '#64748b',
  'Authorised for Collection': '#0284c7',
  'In Transit': '#2563eb',
  'At Returns Dept': '#7c3aed',
  'Awaiting RT Italy': '#9333ea',
  'Awaiting Inspection by Returns': '#c026d3',
  'Inspected': '#ea580c',
  'To Be Returned to Customer': '#16a34a',
  'Warranty Replacement Authorised': '#059669',
  'Return Closed': '#334155'
};

module.exports = { STATUSES, CLOSED_STATUS, STATUS_COLORS };
