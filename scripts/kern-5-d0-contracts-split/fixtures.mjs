import {
  ASYNC_INT_HELPER,
  CAPABILITY,
  INT_IDENTITY,
  JUMP_POSITIONS,
  LOOP_HELPER,
  POSITIONS,
  program,
} from '../kern-5-rt12-linked-jumps/k0-support.mjs';

// One fixture per statement compiler and per walker the split moves: for/while/nested/if-else
// bodies, a jump inside a helper loop, a void handler, a helper call chain for the call-depth
// walkers, and both capability shapes for the closure walkers and the async-position gate.
export const D0_FIXTURES = Object.freeze({
  'capability-async-helper': () => program(['return value="afi()"'], { helpers: [ASYNC_INT_HELPER] }),
  'capability-top-level': () => program([CAPABILITY, 'return value="1"']),
  'helper-integer-identity': () => program(['return value="idp(7)"'], { helpers: [INT_IDENTITY] }),
  'helper-loop-call': () => program(['return value="sumto(4)"'], { helpers: [LOOP_HELPER] }),
  'jump-for-break-after-leaf': () => JUMP_POSITIONS['for-break-after-leaf'](),
  'jump-for-break-if-else': () => JUMP_POSITIONS['for-break-if-else'](),
  'jump-for-continue-last-trip': () => JUMP_POSITIONS['for-continue-last-trip'](),
  'jump-in-loop-in-helper': () => JUMP_POSITIONS['jump-in-loop-in-helper'](),
  'jump-nested-inner-break': () => JUMP_POSITIONS['nested-inner-break'](),
  'jump-void-break-in-loop': () => JUMP_POSITIONS['void-break-in-loop'](),
  'jump-while-continue-under-if': () => JUMP_POSITIONS['while-continue-under-if'](),
  'jump-while-in-for-break': () => JUMP_POSITIONS['while-in-for-break'](),
  'loop-for-if-in-body': () => POSITIONS['for-if-in-body'](),
  'loop-for-sum-0-3': () => POSITIONS['for-sum-0-3'](),
  'loop-for-triple-nested': () => POSITIONS['for-triple-nested'](),
});

export const D0_FIXTURE_NAMES = Object.freeze(Object.keys(D0_FIXTURES).sort());

export const D0_BASE_DIGESTS = Object.freeze({
  'capability-async-helper': Object.freeze({
    artifact: '61ee4b6cf78750d7ad76adda73cc172bc2baaab5cb10fb489b1cea4ebdb89ddd',
    envelope: '7767dc3f465399bffa150deaffdf6f59e63e83568a27bb19039e88128c0b78c5',
    linked: 'fb882629aa6af0251d633ad92bf31d8da21b2ae97d12be4108ab98e74bfc30ca',
  }),
  'capability-top-level': Object.freeze({
    artifact: 'd13b482756ce66916b32ca878fcec494cdd157157dee21a0328e7120e20b1b15',
    envelope: '8b2d772fdad979750890df8936c62f3efdbc44c39f7a673fe842f21c64d380c4',
    linked: '3f75dd3bc4bfd078b9e30755ef80224acd4eaabad5302d264b766a93b44993b3',
  }),
  'helper-integer-identity': Object.freeze({
    artifact: '298a90c5673f61aa0aab49988dde1af75ff22197d6c51d63c0ae823101e68e0b',
    envelope: '0ffd22273ef4d95ca4738ecd5f53d2a62058f14798c5129e9f45ac9f786455ba',
    linked: '156b505731c6cacc518dd23d8004670e13c9e64d47217d8968429e93c7ac1c59',
  }),
  'helper-loop-call': Object.freeze({
    artifact: '7255dd049ac825221e95d2b0f19cdebe955902ade9a944d48f5b5eee52d97d10',
    envelope: '55a53aed66d5a10bf95681f25de8f7912cb22414863c19f5e4484ddf95dae96b',
    linked: '117735d8f30e8adbb9fa55b2f314aa1eb80aeb8b33763c67053e6a315149eb13',
  }),
  'jump-for-break-after-leaf': Object.freeze({
    artifact: '9fb73f93211eb07aeb2b73398f083f314de3d78f79373e24bdbd2f50c06dcbaf',
    envelope: 'fb5aa33ee0b4c4a6345da8bc2f4f4f96fd6ee316e5ef211fe39b18d854dc472e',
    linked: '7509c2f0a08fe2a000b9dc10fbc59eec6dadc0208e7fa0b4473c050590c36d92',
  }),
  'jump-for-break-if-else': Object.freeze({
    artifact: '7475653567340e0d5eba629bdfa4f665661764f8533d523e6df49aad5f59218e',
    envelope: 'fcf22060eb7b2fb6f015ebbc331d78adad1d48248bc6d4ff19e8740dfa13bcdd',
    linked: '2a26519ca3ed323c747424541afc53014d646b4b1336386e4b257ee1b50ca779',
  }),
  'jump-for-continue-last-trip': Object.freeze({
    artifact: 'f73a168f8125fe960a3a8d5c3da21932b894a7fbb34f12f2ca6c6813f24f9c88',
    envelope: '15bce92b0442945600ae4df8ddf6d5a40373f8d00149657d27aa3c20864ca9e4',
    linked: 'fcbad50c5d96206090c9b765f351505f37a276be55f17ff4a9915acd69451f7c',
  }),
  'jump-in-loop-in-helper': Object.freeze({
    artifact: 'd59515444c03f64108858cec841145be9b322a7b9b276cc238cfe535285ac59a',
    envelope: '4881fb988e5977cdba7fe7602667725a80b5f6f767cec11606c2b91ee0797c33',
    linked: '79e41e778d43a540d2bca0ff06bfa5793906f2b4f905c1fd8e50ce794fe3cccb',
  }),
  'jump-nested-inner-break': Object.freeze({
    artifact: 'af5bba389edeb4d128f52387bcee41511ec15acbcffa4b7250d3fdcb876fa570',
    envelope: 'f978a109fae91fab8828f04b37ea0c8b1c9859271be8c5a8a3e4104ebdac5768',
    linked: '86d80376944f608c602b0a82837244c1593cbe31a9e5da2ce1894ca7649b269e',
  }),
  'jump-void-break-in-loop': Object.freeze({
    artifact: '7d1d244bdc9791d1d8010b4a78216562f57984ff36233bdc0c40b3c8106b5daa',
    envelope: '556f13fb7c61d802e4ef237b728c2731154581138dc69981cdf60147250bde7a',
    linked: 'f9dc0cc4d73e93d204db3d2316063c205b17dddc6ee109528a854917fcc3ede8',
  }),
  'jump-while-continue-under-if': Object.freeze({
    artifact: '936172fe980d7bc0c9fd7ed7113232c6c2f2a2928ec5ed1babd0ab2c2a61d3cb',
    envelope: '0a71478e9c5843ed6eb3f1ef5a0c6127708f3881c19e3604b93074deb8e7823f',
    linked: 'bb41df901c259558e03f8607e3546a2340fdf2bed82d199d997250793e36feab',
  }),
  'jump-while-in-for-break': Object.freeze({
    artifact: '987e43fda46ef346c1bb6add3703ab7d6c81f02e6d2e6327330e79fc357b9271',
    envelope: 'b682fba7fba1b7db7ff5610f220e72a5dcbe6c2a41e46be8c7ae64c2edf2b747',
    linked: '48efb454598be45a2e9c0490455cea8142ac17958650b6d01740210238412a7c',
  }),
  'loop-for-if-in-body': Object.freeze({
    artifact: '40024efba9078a7b784a5d4885500c733381b6b1c65612c0f6539326903f374e',
    envelope: '6c4b27bffb41166cd46a6f6c9eff8486c8604403fd094f14fa042dd8fce2a6da',
    linked: '410036cec022041132dbee953e0ec68f067cdbc39556e6f0a27779f6db7fe6be',
  }),
  'loop-for-sum-0-3': Object.freeze({
    artifact: 'b3b0f7de6c02920adb0964ac6ffe8995439c695448108b0e2acf2ceca81d0b96',
    envelope: '7033f7b1264a3fa0aa10f12a344e7061f3d08f38ccf5e434469468edff6020e6',
    linked: '11ca18186833be5b60b786e3fdced3a0a083d301d98bbed577c7d569cf9b049c',
  }),
  'loop-for-triple-nested': Object.freeze({
    artifact: 'b1f76a20995bd1fd75a7b5339fe1b5929cc986d149fb251a77ec86f72e6d02a0',
    envelope: 'c3ce49355be582795acef34a22a1e69b9cc31d3dea4207856b1e0b1f464254d0',
    linked: 'b7b9fc554104e64a87e4d482031b4f7d71f2bc5f943d91eb94e82ebc3f72ff6c',
  }),
});
