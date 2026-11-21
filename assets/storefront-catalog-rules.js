// Merchandising shared by the main storefront and its regular catalogue listing.
(() => {
  const rules = {
    fixedPrices: {'454860479882':4290, '924701650982':4290, '809858137952':4290},
    nubuck: {uid:'454860479882', photo:'/photos/aganta-black-nubuck-cordura.jpg'},
    hunk: {black:'550020260919', pistachio:'550020260920'},
    agantaThermo: {
      black:'550020260921', blue:'550020260922', pistachioWhite:'550020260923',
      beige:'550020260924', sage:'550020260925', oreo:'550020261103'
    },
    familyNames: {Thermo:'Aganta Thermo', 'Hunk Thermo BRFT W':'Hunk Thermo Barefoot'},
    soldOut: ['576612833084','938371874105','901880658842','576555820762','671974984372','246465477824','585095123222','511313321014','375461019313']
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = rules;
  else window.ulteraCatalogRules = rules;
})();
