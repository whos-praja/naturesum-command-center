// AUTO-GENERATED from scripts/import-marketplace-data.cjs
// Source files: Amazon ledger, Blinkit feeder-WH xlsx, Flipkart inventory, Shopify website sales
// Snapshot date: 2026-05-30
// Re-run `node scripts/import-marketplace-data.cjs` after dropping fresh exports into ~/Downloads.

export const REAL_DATA_SNAPSHOT_DATE = "2026-05-30";
export const SHOPIFY_DATE_RANGE = {"first":"2026-03-01","last":"2026-05-30","days":91};

export const REAL_MARKETPLACE_DATA = {
  "NSJO100": {
    "amazon": {
      "byFc": {
        "BOM7": {
          "sellable": 61,
          "damaged": 0,
          "shipped": 0
        },
        "CCX1": {
          "sellable": 87,
          "damaged": 0,
          "shipped": 0
        },
        "DEL4": {
          "sellable": 35,
          "damaged": 0,
          "shipped": 0
        },
        "MAA4": {
          "sellable": 48,
          "damaged": 0,
          "shipped": 2
        }
      },
      "totalSellable": 231,
      "totalDamaged": 0,
      "totalShippedToday": 2
    },
    "blinkit": null,
    "flipkart": {
      "warehouseId": "gur_san_wh_nl_01nl",
      "sellingPrice": 1353,
      "live": 49,
      "sales7d": 0,
      "sales14d": 1,
      "sales30d": 1,
      "sales60d": 1,
      "sales90d": 1,
      "reservedOrders": 0,
      "reservedInt": 0,
      "damaged": 0,
      "transferIncoming": 0,
      "isFAssured": true,
      "fulfilmentType": "Smart/Flipkart, Seller"
    },
    "shopify": {
      "sales7d": -2,
      "sales14d": 2,
      "sales30d": 10,
      "sales60d": 14,
      "sales90d": 20,
      "monthly": [
        10,
        4,
        6
      ]
    }
  },
  "NSSBDB250": {
    "amazon": {
      "byFc": {
        "BOM5": {
          "sellable": 5,
          "damaged": 0,
          "shipped": 0
        },
        "CCX1": {
          "sellable": 1,
          "damaged": 0,
          "shipped": 0
        },
        "DEL4": {
          "sellable": 1,
          "damaged": 0,
          "shipped": 0
        },
        "MAA4": {
          "sellable": 0,
          "damaged": 0,
          "shipped": 1
        }
      },
      "totalSellable": 7,
      "totalDamaged": 0,
      "totalShippedToday": 1
    },
    "blinkit": {
      "byWh": {
        "Noida N1 - Feeder": {
          "sellable": 59,
          "damaged": 1,
          "lost": 0,
          "sales7d": 5,
          "sales15d": 17,
          "sales30d": 37
        },
        "Chennai C5 - Feeder": {
          "sellable": 35,
          "damaged": 0,
          "lost": 0,
          "sales7d": 0,
          "sales15d": 3,
          "sales30d": 6
        },
        "Faridabad - Feeder": {
          "sellable": 5,
          "damaged": 0,
          "lost": 0,
          "sales7d": 6,
          "sales15d": 22,
          "sales30d": 67
        }
      },
      "totalSellable": 99,
      "totalDamaged": 1,
      "totalSales30d": 110,
      "everLaunched": [
        "Noida N1 - Feeder",
        "Chennai C5 - Feeder",
        "Faridabad - Feeder"
      ]
    },
    "flipkart": {
      "warehouseId": "gur_san_wh_nl_01nl",
      "sellingPrice": 744,
      "live": 20,
      "sales7d": 25,
      "sales14d": 77,
      "sales30d": 102,
      "sales60d": 248,
      "sales90d": 389,
      "reservedOrders": 2,
      "reservedInt": 2,
      "damaged": 0,
      "transferIncoming": 0,
      "isFAssured": true,
      "fulfilmentType": "Smart/Flipkart, Seller"
    },
    "shopify": {
      "sales7d": 18,
      "sales14d": 32,
      "sales30d": 78,
      "sales60d": 264,
      "sales90d": 381,
      "monthly": [
        78,
        186,
        117
      ]
    }
  },
  "NSSBDB100": {
    "amazon": {
      "byFc": {
        "BOM7": {
          "sellable": 1,
          "damaged": 0,
          "shipped": 0
        },
        "CCX2": {
          "sellable": 24,
          "damaged": 0,
          "shipped": 0
        },
        "CJB1": {
          "sellable": 17,
          "damaged": 0,
          "shipped": 0
        },
        "DED4": {
          "sellable": 79,
          "damaged": 0,
          "shipped": 0
        },
        "DEL4": {
          "sellable": 2,
          "damaged": 1,
          "shipped": 0
        },
        "DEL5": {
          "sellable": 44,
          "damaged": 0,
          "shipped": 0
        },
        "PNQ3": {
          "sellable": 4,
          "damaged": 0,
          "shipped": 0
        }
      },
      "totalSellable": 171,
      "totalDamaged": 1,
      "totalShippedToday": 0
    },
    "blinkit": {
      "byWh": {
        "Noida N1 - Feeder": {
          "sellable": 0,
          "damaged": 0,
          "lost": 0,
          "sales7d": 0,
          "sales15d": 0,
          "sales30d": 0
        }
      },
      "totalSellable": 0,
      "totalDamaged": 0,
      "totalSales30d": 0,
      "everLaunched": [
        "Noida N1 - Feeder"
      ]
    },
    "flipkart": {
      "warehouseId": "gur_san_wh_nl_01nl",
      "sellingPrice": 420,
      "live": 150,
      "sales7d": 23,
      "sales14d": 55,
      "sales30d": 121,
      "sales60d": 298,
      "sales90d": 426,
      "reservedOrders": 6,
      "reservedInt": 1,
      "damaged": 0,
      "transferIncoming": 0,
      "isFAssured": true,
      "fulfilmentType": "Smart/Flipkart, Seller"
    },
    "shopify": {
      "sales7d": 9,
      "sales14d": 18,
      "sales30d": 71,
      "sales60d": 170,
      "sales90d": 288,
      "monthly": [
        71,
        99,
        118
      ]
    }
  },
  "NSACDT30": {
    "amazon": {
      "byFc": {
        "CCX1": {
          "sellable": 31,
          "damaged": 0,
          "shipped": 0
        },
        "MAA4": {
          "sellable": 11,
          "damaged": 0,
          "shipped": 2
        }
      },
      "totalSellable": 42,
      "totalDamaged": 0,
      "totalShippedToday": 2
    },
    "blinkit": {
      "byWh": {
        "Faridabad - Feeder": {
          "sellable": 0,
          "damaged": 3,
          "lost": 0,
          "sales7d": 0,
          "sales15d": 0,
          "sales30d": 0
        }
      },
      "totalSellable": 0,
      "totalDamaged": 3,
      "totalSales30d": 0,
      "everLaunched": [
        "Faridabad - Feeder"
      ]
    },
    "flipkart": {
      "warehouseId": "gur_san_wh_nl_01nl",
      "sellingPrice": 558,
      "live": 27,
      "sales7d": 0,
      "sales14d": 0,
      "sales30d": 1,
      "sales60d": 2,
      "sales90d": 3,
      "reservedOrders": 0,
      "reservedInt": 0,
      "damaged": 0,
      "transferIncoming": 0,
      "isFAssured": true,
      "fulfilmentType": "Smart/Flipkart, Seller"
    },
    "shopify": {
      "sales7d": 0,
      "sales14d": 0,
      "sales30d": 0,
      "sales60d": 4,
      "sales90d": 7,
      "monthly": [
        0,
        4,
        3
      ]
    }
  },
  "NSSBDB500": {
    "amazon": {
      "byFc": {
        "BOM7": {
          "sellable": 4,
          "damaged": 0,
          "shipped": 0
        },
        "CCX1": {
          "sellable": 2,
          "damaged": 0,
          "shipped": 0
        },
        "DED4": {
          "sellable": 4,
          "damaged": 0,
          "shipped": 0
        },
        "DEL4": {
          "sellable": 1,
          "damaged": 0,
          "shipped": 0
        },
        "DEL5": {
          "sellable": 1,
          "damaged": 0,
          "shipped": 0
        },
        "MAA4": {
          "sellable": 5,
          "damaged": 0,
          "shipped": 0
        }
      },
      "totalSellable": 17,
      "totalDamaged": 0,
      "totalShippedToday": 0
    },
    "blinkit": {
      "byWh": {
        "Kundli Feeder": {
          "sellable": 2,
          "damaged": 0,
          "lost": 0,
          "sales7d": 0,
          "sales15d": 1,
          "sales30d": 4
        },
        "Noida N1 - Feeder": {
          "sellable": 53,
          "damaged": 2,
          "lost": 0,
          "sales7d": 4,
          "sales15d": 7,
          "sales30d": 23
        },
        "Chennai C5 - Feeder": {
          "sellable": 32,
          "damaged": 0,
          "lost": 0,
          "sales7d": 0,
          "sales15d": 0,
          "sales30d": 1
        },
        "Faridabad - Feeder": {
          "sellable": 27,
          "damaged": 8,
          "lost": 0,
          "sales7d": 15,
          "sales15d": 28,
          "sales30d": 50
        }
      },
      "totalSellable": 114,
      "totalDamaged": 10,
      "totalSales30d": 78,
      "everLaunched": [
        "Kundli Feeder",
        "Noida N1 - Feeder",
        "Chennai C5 - Feeder",
        "Faridabad - Feeder"
      ]
    },
    "flipkart": {
      "warehouseId": "gur_san_wh_nl_01nl",
      "sellingPrice": 1176,
      "live": 0,
      "sales7d": 9,
      "sales14d": 31,
      "sales30d": 73,
      "sales60d": 139,
      "sales90d": 179,
      "reservedOrders": 0,
      "reservedInt": 0,
      "damaged": 0,
      "transferIncoming": 0,
      "isFAssured": true,
      "fulfilmentType": "Smart/Flipkart, Seller"
    },
    "shopify": {
      "sales7d": 21,
      "sales14d": 45,
      "sales30d": 80,
      "sales60d": 170,
      "sales90d": 372,
      "monthly": [
        80,
        90,
        202
      ]
    }
  },
  "NSSB250": {
    "amazon": {
      "byFc": {
        "BOM7": {
          "sellable": 121,
          "damaged": 0,
          "shipped": 2
        },
        "CCX1": {
          "sellable": 147,
          "damaged": 0,
          "shipped": 1
        },
        "CCX2": {
          "sellable": 18,
          "damaged": 0,
          "shipped": 0
        },
        "CJB1": {
          "sellable": 44,
          "damaged": 0,
          "shipped": 1
        },
        "DED4": {
          "sellable": 87,
          "damaged": 0,
          "shipped": 2
        },
        "DEL4": {
          "sellable": 82,
          "damaged": 0,
          "shipped": 1
        },
        "DEL5": {
          "sellable": 190,
          "damaged": 0,
          "shipped": 3
        },
        "MAA4": {
          "sellable": 78,
          "damaged": 0,
          "shipped": 1
        },
        "PNQ3": {
          "sellable": 92,
          "damaged": 0,
          "shipped": 0
        }
      },
      "totalSellable": 859,
      "totalDamaged": 0,
      "totalShippedToday": 11
    },
    "blinkit": {
      "byWh": {
        "Lucknow L4": {
          "sellable": 16,
          "damaged": 0,
          "lost": 0,
          "sales7d": 0,
          "sales15d": 0,
          "sales30d": 0
        },
        "Bengaluru B3": {
          "sellable": 46,
          "damaged": 0,
          "lost": 0,
          "sales7d": 1,
          "sales15d": 1,
          "sales30d": 1
        },
        "Ahmedabad A2 - Feeder": {
          "sellable": 29,
          "damaged": 0,
          "lost": 0,
          "sales7d": 1,
          "sales15d": 1,
          "sales30d": 1
        },
        "Noida N1 - Feeder": {
          "sellable": 70,
          "damaged": 1,
          "lost": 0,
          "sales7d": 5,
          "sales15d": 10,
          "sales30d": 21
        },
        "Jaipur J3 - Feeder": {
          "sellable": 21,
          "damaged": 0,
          "lost": 0,
          "sales7d": 1,
          "sales15d": 1,
          "sales30d": 1
        },
        "Hyderabad H3 - Feeder": {
          "sellable": 58,
          "damaged": 0,
          "lost": 0,
          "sales7d": 0,
          "sales15d": 0,
          "sales30d": 0
        },
        "Pune P3 - Feeder Warehouse": {
          "sellable": 53,
          "damaged": 0,
          "lost": 0,
          "sales7d": 1,
          "sales15d": 1,
          "sales30d": 1
        },
        "Kolkata K6 - Feeder Warehouse": {
          "sellable": 29,
          "damaged": 0,
          "lost": 0,
          "sales7d": 6,
          "sales15d": 6,
          "sales30d": 6
        },
        "Faridabad - Feeder": {
          "sellable": 0,
          "damaged": 0,
          "lost": 0,
          "sales7d": 1,
          "sales15d": 3,
          "sales30d": 8
        },
        "Bengaluru B5 - Feeder": {
          "sellable": 51,
          "damaged": 0,
          "lost": 0,
          "sales7d": 3,
          "sales15d": 3,
          "sales30d": 3
        }
      },
      "totalSellable": 373,
      "totalDamaged": 1,
      "totalSales30d": 42,
      "everLaunched": [
        "Lucknow L4",
        "Bengaluru B3",
        "Ahmedabad A2 - Feeder",
        "Noida N1 - Feeder",
        "Jaipur J3 - Feeder",
        "Hyderabad H3 - Feeder",
        "Pune P3 - Feeder Warehouse",
        "Kolkata K6 - Feeder Warehouse",
        "Faridabad - Feeder",
        "Bengaluru B5 - Feeder"
      ]
    },
    "flipkart": {
      "warehouseId": "gur_san_wh_nl_01nl",
      "sellingPrice": 746,
      "live": 27,
      "sales7d": 19,
      "sales14d": 27,
      "sales30d": 66,
      "sales60d": 179,
      "sales90d": 180,
      "reservedOrders": 0,
      "reservedInt": 2,
      "damaged": 0,
      "transferIncoming": 0,
      "isFAssured": false,
      "fulfilmentType": "Smart/Flipkart, Seller"
    },
    "shopify": {
      "sales7d": 13,
      "sales14d": 22,
      "sales30d": 36,
      "sales60d": 101,
      "sales90d": 313,
      "monthly": [
        36,
        65,
        212
      ]
    }
  },
  "NSSB100": {
    "amazon": {
      "byFc": {
        "BOM5": {
          "sellable": 6,
          "damaged": 0,
          "shipped": 0
        },
        "BOM7": {
          "sellable": 109,
          "damaged": 0,
          "shipped": 1
        },
        "CCX1": {
          "sellable": 58,
          "damaged": 0,
          "shipped": 0
        },
        "CCX2": {
          "sellable": 6,
          "damaged": 0,
          "shipped": 2
        },
        "CJB1": {
          "sellable": 3,
          "damaged": 0,
          "shipped": 0
        },
        "DED3": {
          "sellable": 1,
          "damaged": 0,
          "shipped": 0
        },
        "DED4": {
          "sellable": 15,
          "damaged": 0,
          "shipped": 0
        },
        "DEL4": {
          "sellable": 189,
          "damaged": 0,
          "shipped": 2
        },
        "DEL5": {
          "sellable": 52,
          "damaged": 0,
          "shipped": 0
        },
        "MAA4": {
          "sellable": 58,
          "damaged": 0,
          "shipped": 1
        },
        "PNQ3": {
          "sellable": 12,
          "damaged": 0,
          "shipped": 0
        }
      },
      "totalSellable": 509,
      "totalDamaged": 0,
      "totalShippedToday": 6
    },
    "blinkit": {
      "byWh": {
        "Lucknow L4": {
          "sellable": 15,
          "damaged": 0,
          "lost": 0,
          "sales7d": 1,
          "sales15d": 1,
          "sales30d": 1
        },
        "Bengaluru B3": {
          "sellable": 43,
          "damaged": 0,
          "lost": 0,
          "sales7d": 5,
          "sales15d": 5,
          "sales30d": 5
        },
        "Kundli Feeder": {
          "sellable": 1,
          "damaged": 1,
          "lost": 0,
          "sales7d": 0,
          "sales15d": 0,
          "sales30d": 0
        },
        "Mumbai M10 - Feeder": {
          "sellable": 73,
          "damaged": 0,
          "lost": 0,
          "sales7d": 10,
          "sales15d": 19,
          "sales30d": 19
        },
        "Ahmedabad A2 - Feeder": {
          "sellable": 27,
          "damaged": 0,
          "lost": 0,
          "sales7d": 3,
          "sales15d": 3,
          "sales30d": 3
        },
        "Noida N1 - Feeder": {
          "sellable": 124,
          "damaged": 3,
          "lost": 0,
          "sales7d": 11,
          "sales15d": 31,
          "sales30d": 56
        },
        "Jaipur J3 - Feeder": {
          "sellable": 21,
          "damaged": 0,
          "lost": 0,
          "sales7d": 1,
          "sales15d": 1,
          "sales30d": 1
        },
        "Hyderabad H3 - Feeder": {
          "sellable": 39,
          "damaged": 0,
          "lost": 0,
          "sales7d": 0,
          "sales15d": 0,
          "sales30d": 0
        },
        "Pune P3 - Feeder Warehouse": {
          "sellable": 50,
          "damaged": 0,
          "lost": 0,
          "sales7d": 4,
          "sales15d": 4,
          "sales30d": 4
        },
        "Kolkata K6 - Feeder Warehouse": {
          "sellable": 27,
          "damaged": 0,
          "lost": 0,
          "sales7d": 9,
          "sales15d": 9,
          "sales30d": 9
        },
        "Faridabad - Feeder": {
          "sellable": 1,
          "damaged": 0,
          "lost": 1,
          "sales7d": 1,
          "sales15d": 3,
          "sales30d": 8
        },
        "Bengaluru B5 - Feeder": {
          "sellable": 50,
          "damaged": 0,
          "lost": 0,
          "sales7d": 2,
          "sales15d": 4,
          "sales30d": 4
        }
      },
      "totalSellable": 471,
      "totalDamaged": 5,
      "totalSales30d": 110,
      "everLaunched": [
        "Lucknow L4",
        "Bengaluru B3",
        "Kundli Feeder",
        "Mumbai M10 - Feeder",
        "Ahmedabad A2 - Feeder",
        "Noida N1 - Feeder",
        "Jaipur J3 - Feeder",
        "Hyderabad H3 - Feeder",
        "Pune P3 - Feeder Warehouse",
        "Kolkata K6 - Feeder Warehouse",
        "Faridabad - Feeder",
        "Bengaluru B5 - Feeder"
      ]
    },
    "flipkart": {
      "warehouseId": "gur_san_wh_nl_01nl",
      "sellingPrice": 444,
      "live": 111,
      "sales7d": 22,
      "sales14d": 35,
      "sales30d": 40,
      "sales60d": 136,
      "sales90d": 220,
      "reservedOrders": 1,
      "reservedInt": 2,
      "damaged": 0,
      "transferIncoming": 0,
      "isFAssured": false,
      "fulfilmentType": "Smart/Flipkart, Seller"
    },
    "shopify": {
      "sales7d": 18,
      "sales14d": 28,
      "sales30d": 60,
      "sales60d": 72,
      "sales90d": 160,
      "monthly": [
        60,
        12,
        88
      ]
    }
  },
  "NSSB500": {
    "amazon": {
      "byFc": {
        "BOM7": {
          "sellable": 59,
          "damaged": 0,
          "shipped": 0
        },
        "CCX1": {
          "sellable": 72,
          "damaged": 0,
          "shipped": 1
        },
        "CCX2": {
          "sellable": 30,
          "damaged": 0,
          "shipped": 1
        },
        "CJB1": {
          "sellable": 24,
          "damaged": 0,
          "shipped": 1
        },
        "DED3": {
          "sellable": 0,
          "damaged": 0,
          "shipped": 0
        },
        "DED4": {
          "sellable": 50,
          "damaged": 0,
          "shipped": 2
        },
        "DEL4": {
          "sellable": 96,
          "damaged": 0,
          "shipped": 3
        },
        "DEL5": {
          "sellable": 52,
          "damaged": 0,
          "shipped": 2
        },
        "MAA4": {
          "sellable": 63,
          "damaged": 0,
          "shipped": 0
        },
        "PNQ3": {
          "sellable": 99,
          "damaged": 0,
          "shipped": 0
        }
      },
      "totalSellable": 545,
      "totalDamaged": 0,
      "totalShippedToday": 10
    },
    "blinkit": {
      "byWh": {
        "Faridabad - Feeder": {
          "sellable": 0,
          "damaged": 0,
          "lost": 0,
          "sales7d": 0,
          "sales15d": 0,
          "sales30d": 0
        }
      },
      "totalSellable": 0,
      "totalDamaged": 0,
      "totalSales30d": 0,
      "everLaunched": [
        "Faridabad - Feeder"
      ]
    },
    "flipkart": {
      "warehouseId": "gur_san_wh_nl_01nl",
      "sellingPrice": 1363,
      "live": 99,
      "sales7d": 7,
      "sales14d": 10,
      "sales30d": 11,
      "sales60d": 11,
      "sales90d": 11,
      "reservedOrders": 2,
      "reservedInt": 0,
      "damaged": 0,
      "transferIncoming": 0,
      "isFAssured": false,
      "fulfilmentType": "Smart/Flipkart, Seller"
    },
    "shopify": {
      "sales7d": 18,
      "sales14d": 24,
      "sales30d": 48,
      "sales60d": 59,
      "sales90d": 130,
      "monthly": [
        48,
        11,
        71
      ]
    }
  },
  "NSSBJ500": {
    "amazon": {
      "byFc": {
        "CCX1": {
          "sellable": 2,
          "damaged": 0,
          "shipped": 1
        },
        "DEL4": {
          "sellable": 0,
          "damaged": 1,
          "shipped": 0
        },
        "MAA4": {
          "sellable": 1,
          "damaged": 1,
          "shipped": 0
        },
        "BOM7": {
          "sellable": 0,
          "damaged": 1,
          "shipped": 0
        }
      },
      "totalSellable": 3,
      "totalDamaged": 3,
      "totalShippedToday": 1
    },
    "blinkit": null,
    "flipkart": {
      "warehouseId": "gur_san_wh_nl_01nl",
      "sellingPrice": 1193,
      "live": 132,
      "sales7d": 23,
      "sales14d": 30,
      "sales30d": 30,
      "sales60d": 35,
      "sales90d": 35,
      "reservedOrders": 3,
      "reservedInt": 0,
      "damaged": 0,
      "transferIncoming": 0,
      "isFAssured": true,
      "fulfilmentType": "Smart/Flipkart, Seller"
    },
    "shopify": {
      "sales7d": 77,
      "sales14d": 123,
      "sales30d": 243,
      "sales60d": 251,
      "sales90d": 251,
      "monthly": [
        243,
        8,
        0
      ]
    }
  },
  "NSSBJ300": {
    "amazon": {
      "byFc": {
        "BOM7": {
          "sellable": 23,
          "damaged": 0,
          "shipped": 13
        },
        "CCX1": {
          "sellable": 26,
          "damaged": 0,
          "shipped": 13
        },
        "DEL4": {
          "sellable": 2,
          "damaged": 0,
          "shipped": 0
        },
        "MAA4": {
          "sellable": 59,
          "damaged": 0,
          "shipped": 3
        }
      },
      "totalSellable": 110,
      "totalDamaged": 0,
      "totalShippedToday": 29
    },
    "blinkit": {
      "byWh": {
        "Chennai C5 - Feeder": {
          "sellable": 3,
          "damaged": 0,
          "lost": 1,
          "sales7d": 2,
          "sales15d": 14,
          "sales30d": 14
        }
      },
      "totalSellable": 3,
      "totalDamaged": 1,
      "totalSales30d": 14,
      "everLaunched": [
        "Chennai C5 - Feeder"
      ]
    },
    "flipkart": {
      "warehouseId": "gur_san_wh_nl_01nl",
      "sellingPrice": 715,
      "live": 55,
      "sales7d": 18,
      "sales14d": 38,
      "sales30d": 50,
      "sales60d": 64,
      "sales90d": 64,
      "reservedOrders": 2,
      "reservedInt": 0,
      "damaged": 0,
      "transferIncoming": 0,
      "isFAssured": true,
      "fulfilmentType": "Smart/Flipkart, Seller"
    },
    "shopify": {
      "sales7d": 33,
      "sales14d": 49,
      "sales30d": 96,
      "sales60d": 106,
      "sales90d": 106,
      "monthly": [
        96,
        10,
        0
      ]
    }
  },
  "NSMP100": {
    "amazon": {
      "byFc": {
        "BOM5": {
          "sellable": 18,
          "damaged": 0,
          "shipped": 0
        },
        "BOM7": {
          "sellable": 1,
          "damaged": 0,
          "shipped": 0
        },
        "CCX1": {
          "sellable": 2,
          "damaged": 0,
          "shipped": 0
        },
        "CCX2": {
          "sellable": 11,
          "damaged": 0,
          "shipped": 0
        },
        "CJB1": {
          "sellable": 4,
          "damaged": 0,
          "shipped": 0
        },
        "DED4": {
          "sellable": 16,
          "damaged": 0,
          "shipped": 1
        },
        "DEL4": {
          "sellable": 7,
          "damaged": 0,
          "shipped": 0
        },
        "DEL5": {
          "sellable": 14,
          "damaged": 0,
          "shipped": 2
        },
        "MAA4": {
          "sellable": 5,
          "damaged": 0,
          "shipped": 0
        },
        "PNQ3": {
          "sellable": 3,
          "damaged": 0,
          "shipped": 0
        }
      },
      "totalSellable": 81,
      "totalDamaged": 0,
      "totalShippedToday": 3
    },
    "blinkit": null,
    "flipkart": {
      "warehouseId": "gur_san_wh_nl_01nl",
      "sellingPrice": 282,
      "live": 100,
      "sales7d": 0,
      "sales14d": 0,
      "sales30d": 0,
      "sales60d": 0,
      "sales90d": 0,
      "reservedOrders": 0,
      "reservedInt": 0,
      "damaged": 0,
      "transferIncoming": 0,
      "isFAssured": true,
      "fulfilmentType": "Seller"
    },
    "shopify": {
      "sales7d": 7,
      "sales14d": 8,
      "sales30d": 9,
      "sales60d": 9,
      "sales90d": 9,
      "monthly": [
        9,
        0,
        0
      ]
    }
  },
  "NSMP250": {
    "amazon": {
      "byFc": {
        "DED4": {
          "sellable": 97,
          "damaged": 0,
          "shipped": 1
        }
      },
      "totalSellable": 97,
      "totalDamaged": 0,
      "totalShippedToday": 1
    },
    "blinkit": null,
    "flipkart": {
      "warehouseId": "gur_san_wh_nl_01nl",
      "sellingPrice": 567,
      "live": 100,
      "sales7d": 0,
      "sales14d": 0,
      "sales30d": 0,
      "sales60d": 0,
      "sales90d": 0,
      "reservedOrders": 0,
      "reservedInt": 0,
      "damaged": 0,
      "transferIncoming": 0,
      "isFAssured": true,
      "fulfilmentType": "Seller"
    },
    "shopify": null
  },
  "NSSBBO30": {
    "amazon": null,
    "blinkit": null,
    "flipkart": null,
    "shopify": {
      "sales7d": 0,
      "sales14d": 0,
      "sales30d": 0,
      "sales60d": 0,
      "sales90d": -2,
      "monthly": [
        0,
        0,
        -2
      ]
    }
  }
};
