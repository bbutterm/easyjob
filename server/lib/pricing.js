'use strict';
// Only numeric metadata leaves this module. No request/response text is retained.
function load(env = process.env) {
  try {
    const prices = JSON.parse(env.AI_PRICES_JSON || '{}');
    const version = env.AI_PRICING_VERSION || 'unconfigured';
    if (!prices || Array.isArray(prices) || typeof prices !== 'object' || !/^[a-zA-Z0-9_.:-]{1,80}$/.test(version)) throw 0;
    if (Object.keys(prices).length && version === 'unconfigured') throw 0;
    for (const models of Object.values(prices)) {
      if (!models || typeof models !== 'object' || Array.isArray(models)) throw 0;
      for (const rate of Object.values(models)) {
        if (!rate || !['input', 'output'].every(k => typeof rate[k] === 'number' && Number.isFinite(rate[k]) && rate[k] >= 0 && rate[k] <= 1000000)) throw 0;
      }
    }
    return { prices, version };
  } catch (_) { throw new Error('Некорректная конфигурация AI pricing'); }
}
const valid = n => Number.isSafeInteger(n) && n >= 0;
// UTF-8 byte count + message overhead: intentionally conservative, not a tokenizer.
const estimate = text => Buffer.byteLength(String(text || ''), 'utf8');
function account(request, result, pricing = load()) {
  const inputReported = valid(result.usage && result.usage.input);
  const outputReported = valid(result.usage && result.usage.output);
  const tokensIn = inputReported ? result.usage.input : estimate(request.system) + estimate(request.userText) + 32;
  const tokensOut = outputReported ? result.usage.output : estimate(result.text);
  const rate = pricing.prices[request.provider]?.[request.model];
  return { tokensIn, tokensOut, estimated: !inputReported || !outputReported,
    inputEstimated: !inputReported, outputEstimated: !outputReported,
    costUsd: rate ? (tokensIn * rate.input + tokensOut * rate.output) / 1000000 : 0,
    pricingMissing: !rate, pricingVersion: pricing.version };
}
module.exports = { load, account };
