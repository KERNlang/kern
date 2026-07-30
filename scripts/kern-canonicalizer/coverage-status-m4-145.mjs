import {
  validateCanonicalizerCombinedHeadroomM4145,
} from './combined-headroom-m4-145.mjs';

function fail() {
  throw new TypeError('M4.145 status requires the exact combined headroom GO');
}

export function formatM4145CombinedHeadroomStatus(receipt) {
  try {
    validateCanonicalizerCombinedHeadroomM4145(receipt);
  } catch {
    fail();
  }
  return 'M4.145 authenticates combined KIR/profile structural safety and exact floor ' +
    '43054 with 6098 promotion-budget and 22482 production headroom; M4.146 ' +
    'promotes the exact candidate and publishes the expressionsources queue.';
}
