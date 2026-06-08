/**
 * bundledAgencyData.js — auto-generated from the founder's Agency
 * Channel-wise Sales Sheet. DO NOT hand-edit. Regenerate via
 * `node scripts/build-bundled-agency.cjs <path-to-xlsx>`.
 *
 * Shape: { snapshotDate, byCode: { <canonical>: { amazon | blinkit | flipkart:
 *   { sales7d, sales14d, sales15d, sales30d, sales60d, dailyOut, growth,
 *     monthly:[m0,m1,m2,m3] } } } }
 *   - sales14d  → D5 MAX(30d,14d) velocity window.
 *   - monthly[] → trailing-30d sums, MOST-RECENT FIRST → max-trailing-MoM growth.
 *
 * Per founder's truth table, this is the source-of-truth for Amazon channel
 * velocity + growth (and a fallback for Flipkart/Blinkit when their native
 * exports are missing). data.js layers a live upload on top of this baseline.
 */
export const BUNDLED_AGENCY_DATA = {
  "snapshotDate": "2026-05-31",
  "byCode": {
    "NSJO100": {
      "blinkit": {
        "sales7d": 0,
        "sales14d": 0,
        "sales15d": 0,
        "sales30d": 0,
        "sales60d": 0,
        "dailyOut": 0,
        "growth": null,
        "monthly": [
          0,
          0,
          0,
          0
        ]
      },
      "amazon": {
        "sales7d": 6,
        "sales14d": 13,
        "sales15d": 15,
        "sales30d": 28,
        "sales60d": 72,
        "dailyOut": 0.933,
        "growth": -36.4,
        "monthly": [
          28,
          44,
          37,
          56
        ]
      },
      "flipkart": {
        "sales7d": 0,
        "sales14d": 1,
        "sales15d": 1,
        "sales30d": 1,
        "sales60d": 2,
        "dailyOut": 0.033,
        "growth": 0,
        "monthly": [
          1,
          1,
          0,
          0
        ]
      }
    },
    "NSSBDB100": {
      "blinkit": {
        "sales7d": 0,
        "sales14d": 0,
        "sales15d": 0,
        "sales30d": 0,
        "sales60d": 0,
        "dailyOut": 0,
        "growth": null,
        "monthly": [
          0,
          0,
          0,
          8
        ]
      },
      "amazon": {
        "sales7d": 18,
        "sales14d": 63,
        "sales15d": 66,
        "sales30d": 127,
        "sales60d": 296,
        "dailyOut": 4.233,
        "growth": -24.9,
        "monthly": [
          127,
          169,
          173,
          205
        ]
      },
      "flipkart": {
        "sales7d": 10,
        "sales14d": 41,
        "sales15d": 46,
        "sales30d": 111,
        "sales60d": 284,
        "dailyOut": 3.7,
        "growth": -35.8,
        "monthly": [
          111,
          173,
          127,
          177
        ]
      }
    },
    "NSSBDB250": {
      "blinkit": {
        "sales7d": 6,
        "sales14d": 22,
        "sales15d": 26,
        "sales30d": 103,
        "sales60d": 219,
        "dailyOut": 3.433,
        "growth": -11.2,
        "monthly": [
          103,
          116,
          123,
          113
        ]
      },
      "amazon": {
        "sales7d": 1,
        "sales14d": 8,
        "sales15d": 13,
        "sales30d": 55,
        "sales60d": 157,
        "dailyOut": 1.833,
        "growth": -46.1,
        "monthly": [
          55,
          102,
          161,
          181
        ]
      },
      "flipkart": {
        "sales7d": 4,
        "sales14d": 43,
        "sales15d": 47,
        "sales30d": 67,
        "sales60d": 210,
        "dailyOut": 2.233,
        "growth": -53.1,
        "monthly": [
          67,
          143,
          149,
          150
        ]
      }
    },
    "NSSBDB500": {
      "blinkit": {
        "sales7d": 11,
        "sales14d": 26,
        "sales15d": 29,
        "sales30d": 72,
        "sales60d": 146,
        "dailyOut": 2.4,
        "growth": -2.7,
        "monthly": [
          72,
          74,
          41,
          50
        ]
      },
      "amazon": {
        "sales7d": 0,
        "sales14d": 32,
        "sales15d": 41,
        "sales30d": 282,
        "sales60d": 633,
        "dailyOut": 9.4,
        "growth": -19.7,
        "monthly": [
          282,
          351,
          513,
          502
        ]
      },
      "flipkart": {
        "sales7d": 5,
        "sales14d": 23,
        "sales15d": 25,
        "sales30d": 59,
        "sales60d": 117,
        "dailyOut": 1.967,
        "growth": 1.7,
        "monthly": [
          59,
          58,
          43,
          48
        ]
      }
    },
    "NSSBBO15": {
      "blinkit": {
        "sales7d": 0,
        "sales14d": 0,
        "sales15d": 0,
        "sales30d": 0,
        "sales60d": 0,
        "dailyOut": 0,
        "growth": null,
        "monthly": [
          0,
          0,
          0,
          0
        ]
      },
      "amazon": {
        "sales7d": 0,
        "sales14d": 0,
        "sales15d": 0,
        "sales30d": 0,
        "sales60d": 0,
        "dailyOut": 0,
        "growth": null,
        "monthly": [
          0,
          0,
          0,
          33
        ]
      },
      "flipkart": {
        "sales7d": 0,
        "sales14d": 0,
        "sales15d": 0,
        "sales30d": 0,
        "sales60d": 0,
        "dailyOut": 0,
        "growth": null,
        "monthly": [
          0,
          0,
          0,
          0
        ]
      }
    },
    "NSSBBO30": {
      "blinkit": {
        "sales7d": 0,
        "sales14d": 0,
        "sales15d": 0,
        "sales30d": 0,
        "sales60d": 0,
        "dailyOut": 0,
        "growth": null,
        "monthly": [
          0,
          0,
          0,
          0
        ]
      },
      "amazon": {
        "sales7d": 0,
        "sales14d": 0,
        "sales15d": 0,
        "sales30d": 0,
        "sales60d": 0,
        "dailyOut": 0,
        "growth": null,
        "monthly": [
          0,
          0,
          0,
          1
        ]
      },
      "flipkart": {
        "sales7d": 0,
        "sales14d": 0,
        "sales15d": 0,
        "sales30d": 0,
        "sales60d": 0,
        "dailyOut": 0,
        "growth": null,
        "monthly": [
          0,
          0,
          0,
          0
        ]
      }
    },
    "NSACDT30": {
      "blinkit": {
        "sales7d": 0,
        "sales14d": 0,
        "sales15d": 0,
        "sales30d": 0,
        "sales60d": 3,
        "dailyOut": 0,
        "growth": -100,
        "monthly": [
          0,
          3,
          0,
          0
        ]
      },
      "amazon": {
        "sales7d": 12,
        "sales14d": 19,
        "sales15d": 20,
        "sales30d": 36,
        "sales60d": 82,
        "dailyOut": 1.2,
        "growth": -21.7,
        "monthly": [
          36,
          46,
          44,
          28
        ]
      },
      "flipkart": {
        "sales7d": 0,
        "sales14d": 0,
        "sales15d": 0,
        "sales30d": 1,
        "sales60d": 2,
        "dailyOut": 0.033,
        "growth": 0,
        "monthly": [
          1,
          1,
          1,
          1
        ]
      }
    },
    "NSSB100": {
      "blinkit": {
        "sales7d": 33,
        "sales14d": 68,
        "sales15d": 72,
        "sales30d": 107,
        "sales60d": 238,
        "dailyOut": 3.567,
        "growth": -18.3,
        "monthly": [
          107,
          131,
          203,
          270
        ]
      },
      "amazon": {
        "sales7d": 19,
        "sales14d": 35,
        "sales15d": 39,
        "sales30d": 120,
        "sales60d": 328,
        "dailyOut": 4,
        "growth": -42.3,
        "monthly": [
          120,
          208,
          354,
          312
        ]
      },
      "flipkart": {
        "sales7d": 7,
        "sales14d": 16,
        "sales15d": 20,
        "sales30d": 25,
        "sales60d": 119,
        "dailyOut": 0.833,
        "growth": -73.4,
        "monthly": [
          25,
          94,
          84,
          81
        ]
      }
    },
    "NSSB250": {
      "blinkit": {
        "sales7d": 17,
        "sales14d": 22,
        "sales15d": 22,
        "sales30d": 41,
        "sales60d": 105,
        "dailyOut": 1.367,
        "growth": -35.9,
        "monthly": [
          41,
          64,
          53,
          39
        ]
      },
      "amazon": {
        "sales7d": 51,
        "sales14d": 115,
        "sales15d": 116,
        "sales30d": 197,
        "sales60d": 417,
        "dailyOut": 6.567,
        "growth": -10.5,
        "monthly": [
          197,
          220,
          315,
          353
        ]
      },
      "flipkart": {
        "sales7d": 8,
        "sales14d": 14,
        "sales15d": 16,
        "sales30d": 54,
        "sales60d": 171,
        "dailyOut": 1.8,
        "growth": -53.8,
        "monthly": [
          54,
          117,
          50,
          106
        ]
      }
    },
    "NSSB500": {
      "blinkit": {
        "sales7d": 0,
        "sales14d": 0,
        "sales15d": 0,
        "sales30d": 0,
        "sales60d": 12,
        "dailyOut": 0,
        "growth": -100,
        "monthly": [
          0,
          12,
          0,
          0
        ]
      },
      "amazon": {
        "sales7d": 36,
        "sales14d": 69,
        "sales15d": 73,
        "sales30d": 117,
        "sales60d": 244,
        "dailyOut": 3.9,
        "growth": -7.9,
        "monthly": [
          117,
          127,
          147,
          35
        ]
      },
      "flipkart": {
        "sales7d": 4,
        "sales14d": 7,
        "sales15d": 7,
        "sales30d": 8,
        "sales60d": 29,
        "dailyOut": 0.267,
        "growth": -61.9,
        "monthly": [
          8,
          21,
          3,
          1
        ]
      }
    },
    "NSSBJ300": {
      "blinkit": {
        "sales7d": 1,
        "sales14d": 11,
        "sales15d": 11,
        "sales30d": 14,
        "sales60d": 14,
        "dailyOut": 0.467,
        "growth": 200,
        "monthly": [
          14,
          0,
          0,
          0
        ]
      },
      "amazon": {
        "sales7d": 43,
        "sales14d": 70,
        "sales15d": 75,
        "sales30d": 112,
        "sales60d": 122,
        "dailyOut": 3.733,
        "growth": 200,
        "monthly": [
          112,
          10,
          0,
          0
        ]
      },
      "flipkart": {
        "sales7d": 28,
        "sales14d": 55,
        "sales15d": 55,
        "sales30d": 67,
        "sales60d": 81,
        "dailyOut": 2.233,
        "growth": 200,
        "monthly": [
          67,
          14,
          0,
          0
        ]
      }
    },
    "NSSBJ500": {
      "amazon": {
        "sales7d": 148,
        "sales14d": 223,
        "sales15d": 231,
        "sales30d": 301,
        "sales60d": 306,
        "dailyOut": 10.033,
        "growth": 200,
        "monthly": [
          301,
          5,
          0,
          0
        ]
      },
      "flipkart": {
        "sales7d": 3,
        "sales14d": 13,
        "sales15d": 13,
        "sales30d": 13,
        "sales60d": 17,
        "dailyOut": 0.433,
        "growth": 200,
        "monthly": [
          13,
          4,
          0,
          0
        ]
      }
    },
    "NSMP100": {
      "amazon": {
        "sales7d": 4,
        "sales14d": 6,
        "sales15d": 6,
        "sales30d": 6,
        "sales60d": 6,
        "dailyOut": 0.2,
        "growth": 200,
        "monthly": [
          6,
          0,
          0,
          0
        ]
      },
      "flipkart": {
        "sales7d": 0,
        "sales14d": 1,
        "sales15d": 1,
        "sales30d": 1,
        "sales60d": 1,
        "dailyOut": 0.033,
        "growth": 200,
        "monthly": [
          1,
          0,
          0,
          0
        ]
      }
    },
    "NSMP250": {
      "amazon": {
        "sales7d": 1,
        "sales14d": 1,
        "sales15d": 1,
        "sales30d": 1,
        "sales60d": 1,
        "dailyOut": 0.033,
        "growth": 200,
        "monthly": [
          1,
          0,
          0,
          0
        ]
      },
      "flipkart": {
        "sales7d": 0,
        "sales14d": 1,
        "sales15d": 1,
        "sales30d": 1,
        "sales60d": 1,
        "dailyOut": 0.033,
        "growth": 200,
        "monthly": [
          1,
          0,
          0,
          0
        ]
      }
    }
  }
};
