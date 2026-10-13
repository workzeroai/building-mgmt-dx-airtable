---
excalidraw-plugin: parsed
tags: [excalidraw]
---
==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠==
# Drawing
```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "https://github.com/zsviczian/obsidian-excalidraw-plugin/releases/tag/2.0.0",
  "elements": [
    {
      "id": "node-sched",
      "type": "rectangle",
      "x": 0,
      "y": 97.0,
      "width": 160,
      "height": 100,
      "angle": 0,
      "strokeColor": "#0369a1",
      "backgroundColor": "#e0f2fe",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": {
        "type": 3
      },
      "seed": 1014081178,
      "version": 1,
      "versionNonce": 150690460,
      "isDeleted": false,
      "boundElements": [
        {
          "type": "text",
          "id": "text-sched"
        },
        {
          "type": "arrow",
          "id": "edge-sched-cfg-0"
        }
      ],
      "updated": 1760000000000,
      "link": null,
      "locked": false
    },
    {
      "id": "node-cfg",
      "type": "rectangle",
      "x": 240,
      "y": 97.0,
      "width": 160,
      "height": 100,
      "angle": 0,
      "strokeColor": "#3730a3",
      "backgroundColor": "#e0e7ff",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": {
        "type": 3
      },
      "seed": 141459026,
      "version": 1,
      "versionNonce": 1751828934,
      "isDeleted": false,
      "boundElements": [
        {
          "type": "text",
          "id": "text-cfg"
        },
        {
          "type": "arrow",
          "id": "edge-sched-cfg-0"
        },
        {
          "type": "arrow",
          "id": "edge-cfg-get-1"
        }
      ],
      "updated": 1760000000000,
      "link": null,
      "locked": false
    },
    {
      "id": "node-get",
      "type": "rectangle",
      "x": 500,
      "y": 97.0,
      "width": 200,
      "height": 120,
      "angle": 0,
      "strokeColor": "#0369a1",
      "backgroundColor": "#e0f2fe",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": {
        "type": 3
      },
      "seed": 1208992579,
      "version": 1,
      "versionNonce": 857361257,
      "isDeleted": false,
      "boundElements": [
        {
          "type": "text",
          "id": "text-get"
        },
        {
          "type": "arrow",
          "id": "edge-cfg-get-1"
        },
        {
          "type": "arrow",
          "id": "edge-get-plan-2"
        }
      ],
      "updated": 1760000000000,
      "link": null,
      "locked": false
    },
    {
      "id": "node-plan",
      "type": "rectangle",
      "x": 800,
      "y": 97.0,
      "width": 220,
      "height": 120,
      "angle": 0,
      "strokeColor": "#3730a3",
      "backgroundColor": "#e0e7ff",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": {
        "type": 3
      },
      "seed": 569183000,
      "version": 1,
      "versionNonce": 1136165807,
      "isDeleted": false,
      "boundElements": [
        {
          "type": "text",
          "id": "text-plan"
        },
        {
          "type": "arrow",
          "id": "edge-get-plan-2"
        },
        {
          "type": "arrow",
          "id": "edge-plan-gate-3"
        }
      ],
      "updated": 1760000000000,
      "link": null,
      "locked": false
    },
    {
      "id": "node-gate",
      "type": "diamond",
      "x": 1100,
      "y": 97.0,
      "width": 240,
      "height": 100,
      "angle": 0,
      "strokeColor": "#b45309",
      "backgroundColor": "#fef3c7",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": {
        "type": 2
      },
      "seed": 502665661,
      "version": 1,
      "versionNonce": 1154601523,
      "isDeleted": false,
      "boundElements": [
        {
          "type": "text",
          "id": "text-gate"
        },
        {
          "type": "arrow",
          "id": "edge-plan-gate-3"
        },
        {
          "type": "arrow",
          "id": "edge-gate-abort-4"
        },
        {
          "type": "arrow",
          "id": "edge-gate-loop-5"
        }
      ],
      "updated": 1760000000000,
      "link": null,
      "locked": false
    },
    {
      "id": "node-abort",
      "type": "rectangle",
      "x": 1480,
      "y": 97.0,
      "width": 200,
      "height": 100,
      "angle": 0,
      "strokeColor": "#b91c1c",
      "backgroundColor": "#fee2e2",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": {
        "type": 3
      },
      "seed": 19850064,
      "version": 1,
      "versionNonce": 1570243133,
      "isDeleted": false,
      "boundElements": [
        {
          "type": "text",
          "id": "text-abort"
        },
        {
          "type": "arrow",
          "id": "edge-gate-abort-4"
        }
      ],
      "updated": 1760000000000,
      "link": null,
      "locked": false
    },
    {
      "id": "node-loop",
      "type": "rectangle",
      "x": 1140,
      "y": 337.0,
      "width": 160,
      "height": 100,
      "angle": 0,
      "strokeColor": "#3730a3",
      "backgroundColor": "#e0e7ff",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": {
        "type": 3
      },
      "seed": 151688382,
      "version": 1,
      "versionNonce": 409910472,
      "isDeleted": false,
      "boundElements": [
        {
          "type": "text",
          "id": "text-loop"
        },
        {
          "type": "arrow",
          "id": "edge-gate-loop-5"
        },
        {
          "type": "arrow",
          "id": "edge-loop-write-6"
        },
        {
          "type": "arrow",
          "id": "edge-mark-loop-8"
        },
        {
          "type": "arrow",
          "id": "edge-loop-summary-9"
        }
      ],
      "updated": 1760000000000,
      "link": null,
      "locked": false
    },
    {
      "id": "node-write",
      "type": "rectangle",
      "x": 1480,
      "y": 317.0,
      "width": 200,
      "height": 120,
      "angle": 0,
      "strokeColor": "#0369a1",
      "backgroundColor": "#e0f2fe",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": {
        "type": 3
      },
      "seed": 707216624,
      "version": 1,
      "versionNonce": 1552214419,
      "isDeleted": false,
      "boundElements": [
        {
          "type": "text",
          "id": "text-write"
        },
        {
          "type": "arrow",
          "id": "edge-loop-write-6"
        },
        {
          "type": "arrow",
          "id": "edge-write-mark-7"
        }
      ],
      "updated": 1760000000000,
      "link": null,
      "locked": false
    },
    {
      "id": "node-mark",
      "type": "rectangle",
      "x": 1760,
      "y": 337.0,
      "width": 160,
      "height": 100,
      "angle": 0,
      "strokeColor": "#3730a3",
      "backgroundColor": "#e0e7ff",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": {
        "type": 3
      },
      "seed": 114331601,
      "version": 1,
      "versionNonce": 1767627313,
      "isDeleted": false,
      "boundElements": [
        {
          "type": "text",
          "id": "text-mark"
        },
        {
          "type": "arrow",
          "id": "edge-write-mark-7"
        },
        {
          "type": "arrow",
          "id": "edge-mark-loop-8"
        }
      ],
      "updated": 1760000000000,
      "link": null,
      "locked": false
    },
    {
      "id": "node-summary",
      "type": "rectangle",
      "x": 1140,
      "y": 557.0,
      "width": 160,
      "height": 100,
      "angle": 0,
      "strokeColor": "#3730a3",
      "backgroundColor": "#e0e7ff",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": {
        "type": 3
      },
      "seed": 162714569,
      "version": 1,
      "versionNonce": 46007903,
      "isDeleted": false,
      "boundElements": [
        {
          "type": "text",
          "id": "text-summary"
        },
        {
          "type": "arrow",
          "id": "edge-loop-summary-9"
        },
        {
          "type": "arrow",
          "id": "edge-summary-save-10"
        },
        {
          "type": "arrow",
          "id": "edge-summary-errs-11"
        }
      ],
      "updated": 1760000000000,
      "link": null,
      "locked": false
    },
    {
      "id": "node-save",
      "type": "rectangle",
      "x": 1480,
      "y": 557.0,
      "width": 200,
      "height": 100,
      "angle": 0,
      "strokeColor": "#0369a1",
      "backgroundColor": "#e0f2fe",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": {
        "type": 3
      },
      "seed": 1335483423,
      "version": 1,
      "versionNonce": 1988981275,
      "isDeleted": false,
      "boundElements": [
        {
          "type": "text",
          "id": "text-save"
        },
        {
          "type": "arrow",
          "id": "edge-summary-save-10"
        }
      ],
      "updated": 1760000000000,
      "link": null,
      "locked": false
    },
    {
      "id": "node-errs",
      "type": "rectangle",
      "x": 1120,
      "y": 737.0,
      "width": 180,
      "height": 100,
      "angle": 0,
      "strokeColor": "#0369a1",
      "backgroundColor": "#e0f2fe",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": {
        "type": 3
      },
      "seed": 552794964,
      "version": 1,
      "versionNonce": 1024608215,
      "isDeleted": false,
      "boundElements": [
        {
          "type": "text",
          "id": "text-errs"
        },
        {
          "type": "arrow",
          "id": "edge-summary-errs-11"
        }
      ],
      "updated": 1760000000000,
      "link": null,
      "locked": false
    },
    {
      "id": "edge-sched-cfg-0",
      "type": "arrow",
      "x": 168.0,
      "y": 147.0,
      "width": 64.0,
      "height": 0.0,
      "angle": 0,
      "strokeColor": "#334155",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": null,
      "seed": 270436466,
      "version": 1,
      "versionNonce": 1691873571,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1760000000000,
      "link": null,
      "locked": false,
      "points": [
        [
          0.0,
          0.0
        ],
        [
          64.0,
          0.0
        ]
      ],
      "lastCommittedPoint": null,
      "startBinding": {
        "elementId": "node-sched",
        "focus": 0,
        "gap": 8
      },
      "endBinding": {
        "elementId": "node-cfg",
        "focus": 0,
        "gap": 8
      },
      "startArrowhead": null,
      "endArrowhead": "arrow"
    },
    {
      "id": "edge-cfg-get-1",
      "type": "arrow",
      "x": 408.0,
      "y": 152.0,
      "width": 84.0,
      "height": 0.0,
      "angle": 0,
      "strokeColor": "#334155",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": null,
      "seed": 1812616270,
      "version": 1,
      "versionNonce": 1164057326,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1760000000000,
      "link": null,
      "locked": false,
      "points": [
        [
          0.0,
          0.0
        ],
        [
          84.0,
          0.0
        ]
      ],
      "lastCommittedPoint": null,
      "startBinding": {
        "elementId": "node-cfg",
        "focus": 0,
        "gap": 8
      },
      "endBinding": {
        "elementId": "node-get",
        "focus": 0,
        "gap": 8
      },
      "startArrowhead": null,
      "endArrowhead": "arrow"
    },
    {
      "id": "edge-get-plan-2",
      "type": "arrow",
      "x": 708.0,
      "y": 157.0,
      "width": 84.0,
      "height": 0.0,
      "angle": 0,
      "strokeColor": "#334155",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": null,
      "seed": 396161458,
      "version": 1,
      "versionNonce": 646846324,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1760000000000,
      "link": null,
      "locked": false,
      "points": [
        [
          0.0,
          0.0
        ],
        [
          84.0,
          0.0
        ]
      ],
      "lastCommittedPoint": null,
      "startBinding": {
        "elementId": "node-get",
        "focus": 0,
        "gap": 8
      },
      "endBinding": {
        "elementId": "node-plan",
        "focus": 0,
        "gap": 8
      },
      "startArrowhead": null,
      "endArrowhead": "arrow"
    },
    {
      "id": "edge-plan-gate-3",
      "type": "arrow",
      "x": 1028.0,
      "y": 152.0,
      "width": 76.0,
      "height": 0.0,
      "angle": 0,
      "strokeColor": "#334155",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": null,
      "seed": 1535237247,
      "version": 1,
      "versionNonce": 745938397,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1760000000000,
      "link": null,
      "locked": false,
      "points": [
        [
          0.0,
          0.0
        ],
        [
          76.0,
          0.0
        ]
      ],
      "lastCommittedPoint": null,
      "startBinding": {
        "elementId": "node-plan",
        "focus": 0,
        "gap": 8
      },
      "endBinding": {
        "elementId": "node-gate",
        "focus": 0,
        "gap": 8
      },
      "startArrowhead": null,
      "endArrowhead": "arrow"
    },
    {
      "id": "edge-gate-abort-4",
      "type": "arrow",
      "x": 1348.0,
      "y": 147.0,
      "width": 124.0,
      "height": 0.0,
      "angle": 0,
      "strokeColor": "#b91c1c",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [
        "grp-edge-gate-abort-4"
      ],
      "frameId": null,
      "roundness": null,
      "seed": 527342425,
      "version": 1,
      "versionNonce": 1004191115,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1760000000000,
      "link": null,
      "locked": false,
      "points": [
        [
          0.0,
          0.0
        ],
        [
          124.0,
          0.0
        ]
      ],
      "lastCommittedPoint": null,
      "startBinding": {
        "elementId": "node-gate",
        "focus": 0,
        "gap": 8
      },
      "endBinding": {
        "elementId": "node-abort",
        "focus": 0,
        "gap": 8
      },
      "startArrowhead": null,
      "endArrowhead": "arrow"
    },
    {
      "id": "label-edge-gate-abort-4",
      "type": "text",
      "x": 1403.0,
      "y": 119.0,
      "width": 14.0,
      "height": 20.0,
      "angle": 0,
      "strokeColor": "#b91c1c",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 1,
      "strokeStyle": "solid",
      "roughness": 0,
      "opacity": 100,
      "groupIds": [
        "grp-edge-gate-abort-4"
      ],
      "frameId": null,
      "roundness": null,
      "seed": 1106320285,
      "version": 1,
      "versionNonce": 1582350912,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1760000000000,
      "link": null,
      "locked": false,
      "text": "예",
      "fontSize": 16,
      "fontFamily": 2,
      "textAlign": "center",
      "verticalAlign": "middle",
      "baseline": 13.12,
      "containerId": null,
      "originalText": "예",
      "lineHeight": 1.25
    },
    {
      "id": "edge-gate-loop-5",
      "type": "arrow",
      "x": 1220.0,
      "y": 205.0,
      "width": 0.0,
      "height": 124.0,
      "angle": 0,
      "strokeColor": "#334155",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [
        "grp-edge-gate-loop-5"
      ],
      "frameId": null,
      "roundness": null,
      "seed": 1178489648,
      "version": 1,
      "versionNonce": 100846660,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1760000000000,
      "link": null,
      "locked": false,
      "points": [
        [
          0.0,
          0.0
        ],
        [
          0.0,
          124.0
        ]
      ],
      "lastCommittedPoint": null,
      "startBinding": {
        "elementId": "node-gate",
        "focus": 0,
        "gap": 8
      },
      "endBinding": {
        "elementId": "node-loop",
        "focus": 0,
        "gap": 8
      },
      "startArrowhead": null,
      "endArrowhead": "arrow"
    },
    {
      "id": "label-edge-gate-loop-5",
      "type": "text",
      "x": 1228.0,
      "y": 257.0,
      "width": 42.0,
      "height": 20.0,
      "angle": 0,
      "strokeColor": "#334155",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 1,
      "strokeStyle": "solid",
      "roughness": 0,
      "opacity": 100,
      "groupIds": [
        "grp-edge-gate-loop-5"
      ],
      "frameId": null,
      "roundness": null,
      "seed": 215165119,
      "version": 1,
      "versionNonce": 455888854,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1760000000000,
      "link": null,
      "locked": false,
      "text": "아니오",
      "fontSize": 16,
      "fontFamily": 2,
      "textAlign": "center",
      "verticalAlign": "middle",
      "baseline": 13.12,
      "containerId": null,
      "originalText": "아니오",
      "lineHeight": 1.25
    },
    {
      "id": "edge-loop-write-6",
      "type": "arrow",
      "x": 1308.0,
      "y": 382.0,
      "width": 164.0,
      "height": 0.0,
      "angle": 0,
      "strokeColor": "#334155",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [
        "grp-edge-loop-write-6"
      ],
      "frameId": null,
      "roundness": null,
      "seed": 1127520423,
      "version": 1,
      "versionNonce": 1023308240,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1760000000000,
      "link": null,
      "locked": false,
      "points": [
        [
          0.0,
          0.0
        ],
        [
          164.0,
          0.0
        ]
      ],
      "lastCommittedPoint": null,
      "startBinding": {
        "elementId": "node-loop",
        "focus": 0,
        "gap": 8
      },
      "endBinding": {
        "elementId": "node-write",
        "focus": 0,
        "gap": 8
      },
      "startArrowhead": null,
      "endArrowhead": "arrow"
    },
    {
      "id": "label-edge-loop-write-6",
      "type": "text",
      "x": 1374.0,
      "y": 354.0,
      "width": 32.0,
      "height": 20.0,
      "angle": 0,
      "strokeColor": "#334155",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 1,
      "strokeStyle": "solid",
      "roughness": 0,
      "opacity": 100,
      "groupIds": [
        "grp-edge-loop-write-6"
      ],
      "frameId": null,
      "roundness": null,
      "seed": 914053489,
      "version": 1,
      "versionNonce": 684497848,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1760000000000,
      "link": null,
      "locked": false,
      "text": "쓸 건",
      "fontSize": 16,
      "fontFamily": 2,
      "textAlign": "center",
      "verticalAlign": "middle",
      "baseline": 13.12,
      "containerId": null,
      "originalText": "쓸 건",
      "lineHeight": 1.25
    },
    {
      "id": "edge-write-mark-7",
      "type": "arrow",
      "x": 1688.0,
      "y": 382.0,
      "width": 64.0,
      "height": 0.0,
      "angle": 0,
      "strokeColor": "#334155",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": null,
      "seed": 1723078573,
      "version": 1,
      "versionNonce": 143165807,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1760000000000,
      "link": null,
      "locked": false,
      "points": [
        [
          0.0,
          0.0
        ],
        [
          64.0,
          0.0
        ]
      ],
      "lastCommittedPoint": null,
      "startBinding": {
        "elementId": "node-write",
        "focus": 0,
        "gap": 8
      },
      "endBinding": {
        "elementId": "node-mark",
        "focus": 0,
        "gap": 8
      },
      "startArrowhead": null,
      "endArrowhead": "arrow"
    },
    {
      "id": "edge-mark-loop-8",
      "type": "arrow",
      "x": 1752.84,
      "y": 343.42,
      "width": 445.69,
      "height": 111.42,
      "angle": 0,
      "strokeColor": "#334155",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "dashed",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": {
        "type": 2
      },
      "seed": 81936438,
      "version": 1,
      "versionNonce": 559987803,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1760000000000,
      "link": null,
      "locked": false,
      "points": [
        [
          0.0,
          0.0
        ],
        [
          -222.84,
          -111.42
        ],
        [
          -445.69,
          0.0
        ]
      ],
      "lastCommittedPoint": null,
      "startBinding": {
        "elementId": "node-mark",
        "focus": 0,
        "gap": 8
      },
      "endBinding": {
        "elementId": "node-loop",
        "focus": 0,
        "gap": 8
      },
      "startArrowhead": null,
      "endArrowhead": "arrow"
    },
    {
      "id": "edge-loop-summary-9",
      "type": "arrow",
      "x": 1220.0,
      "y": 445.0,
      "width": 0.0,
      "height": 104.0,
      "angle": 0,
      "strokeColor": "#334155",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [
        "grp-edge-loop-summary-9"
      ],
      "frameId": null,
      "roundness": null,
      "seed": 181117789,
      "version": 1,
      "versionNonce": 1292618241,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1760000000000,
      "link": null,
      "locked": false,
      "points": [
        [
          0.0,
          0.0
        ],
        [
          0.0,
          104.0
        ]
      ],
      "lastCommittedPoint": null,
      "startBinding": {
        "elementId": "node-loop",
        "focus": 0,
        "gap": 8
      },
      "endBinding": {
        "elementId": "node-summary",
        "focus": 0,
        "gap": 8
      },
      "startArrowhead": null,
      "endArrowhead": "arrow"
    },
    {
      "id": "label-edge-loop-summary-9",
      "type": "text",
      "x": 1228.0,
      "y": 487.0,
      "width": 14.0,
      "height": 20.0,
      "angle": 0,
      "strokeColor": "#334155",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 1,
      "strokeStyle": "solid",
      "roughness": 0,
      "opacity": 100,
      "groupIds": [
        "grp-edge-loop-summary-9"
      ],
      "frameId": null,
      "roundness": null,
      "seed": 1303281525,
      "version": 1,
      "versionNonce": 821917407,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1760000000000,
      "link": null,
      "locked": false,
      "text": "끝",
      "fontSize": 16,
      "fontFamily": 2,
      "textAlign": "center",
      "verticalAlign": "middle",
      "baseline": 13.12,
      "containerId": null,
      "originalText": "끝",
      "lineHeight": 1.25
    },
    {
      "id": "edge-summary-save-10",
      "type": "arrow",
      "x": 1308.0,
      "y": 607.0,
      "width": 164.0,
      "height": 0.0,
      "angle": 0,
      "strokeColor": "#334155",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": null,
      "seed": 1895462639,
      "version": 1,
      "versionNonce": 1440733268,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1760000000000,
      "link": null,
      "locked": false,
      "points": [
        [
          0.0,
          0.0
        ],
        [
          164.0,
          0.0
        ]
      ],
      "lastCommittedPoint": null,
      "startBinding": {
        "elementId": "node-summary",
        "focus": 0,
        "gap": 8
      },
      "endBinding": {
        "elementId": "node-save",
        "focus": 0,
        "gap": 8
      },
      "startArrowhead": null,
      "endArrowhead": "arrow"
    },
    {
      "id": "edge-summary-errs-11",
      "type": "arrow",
      "x": 1215.0,
      "y": 665.0,
      "width": 0.0,
      "height": 64.0,
      "angle": 0,
      "strokeColor": "#334155",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": null,
      "seed": 77897715,
      "version": 1,
      "versionNonce": 1282739001,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1760000000000,
      "link": null,
      "locked": false,
      "points": [
        [
          0.0,
          0.0
        ],
        [
          0.0,
          64.0
        ]
      ],
      "lastCommittedPoint": null,
      "startBinding": {
        "elementId": "node-summary",
        "focus": 0,
        "gap": 8
      },
      "endBinding": {
        "elementId": "node-errs",
        "focus": 0,
        "gap": 8
      },
      "startArrowhead": null,
      "endArrowhead": "arrow"
    },
    {
      "id": "text-sched",
      "type": "text",
      "x": 37.5,
      "y": 122.0,
      "width": 85.0,
      "height": 50.0,
      "angle": 0,
      "strokeColor": "#0f172a",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 1,
      "strokeStyle": "solid",
      "roughness": 0,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": null,
      "seed": 1281042599,
      "version": 1,
      "versionNonce": 916825957,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1760000000000,
      "link": null,
      "locked": false,
      "text": "Schedule\n매시 실행",
      "fontSize": 20,
      "fontFamily": 2,
      "textAlign": "center",
      "verticalAlign": "middle",
      "baseline": 41.4,
      "containerId": "node-sched",
      "originalText": "Schedule\n매시 실행",
      "lineHeight": 1.25
    },
    {
      "id": "text-cfg",
      "type": "text",
      "x": 275.0,
      "y": 122.0,
      "width": 90.0,
      "height": 50.0,
      "angle": 0,
      "strokeColor": "#0f172a",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 1,
      "strokeStyle": "solid",
      "roughness": 0,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": null,
      "seed": 1155475043,
      "version": 1,
      "versionNonce": 1741011948,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1760000000000,
      "link": null,
      "locked": false,
      "text": "Code\n동기화 설정",
      "fontSize": 20,
      "fontFamily": 2,
      "textAlign": "center",
      "verticalAlign": "middle",
      "baseline": 41.4,
      "containerId": "node-cfg",
      "originalText": "Code\n동기화 설정",
      "lineHeight": 1.25
    },
    {
      "id": "text-get",
      "type": "text",
      "x": 524.5,
      "y": 119.5,
      "width": 151.0,
      "height": 75.0,
      "angle": 0,
      "strokeColor": "#0f172a",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 1,
      "strokeStyle": "solid",
      "roughness": 0,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": null,
      "seed": 27922662,
      "version": 1,
      "versionNonce": 348426413,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1760000000000,
      "link": null,
      "locked": false,
      "text": "HTTP ×3\n직전 기록·허브 원본\n·사본 조회",
      "fontSize": 20,
      "fontFamily": 2,
      "textAlign": "center",
      "verticalAlign": "middle",
      "baseline": 66.4,
      "containerId": "node-get",
      "originalText": "HTTP ×3\n직전 기록·허브 원본\n·사본 조회",
      "lineHeight": 1.25
    },
    {
      "id": "text-plan",
      "type": "text",
      "x": 829.5,
      "y": 119.5,
      "width": 161.0,
      "height": 75.0,
      "angle": 0,
      "strokeColor": "#0f172a",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 1,
      "strokeStyle": "solid",
      "roughness": 0,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": null,
      "seed": 1810488218,
      "version": 1,
      "versionNonce": 1682625571,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1760000000000,
      "link": null,
      "locked": false,
      "text": "Code\n반영 계획\n급감 검사·planSync",
      "fontSize": 20,
      "fontFamily": 2,
      "textAlign": "center",
      "verticalAlign": "middle",
      "baseline": 66.4,
      "containerId": "node-plan",
      "originalText": "Code\n반영 계획\n급감 검사·planSync",
      "lineHeight": 1.25
    },
    {
      "id": "text-gate",
      "type": "text",
      "x": 1179.0,
      "y": 134.5,
      "width": 82.0,
      "height": 25.0,
      "angle": 0,
      "strokeColor": "#0f172a",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 1,
      "strokeStyle": "solid",
      "roughness": 0,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": null,
      "seed": 1710322346,
      "version": 1,
      "versionNonce": 613392544,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1760000000000,
      "link": null,
      "locked": false,
      "text": "반영 중단?",
      "fontSize": 20,
      "fontFamily": 2,
      "textAlign": "center",
      "verticalAlign": "middle",
      "baseline": 16.4,
      "containerId": "node-gate",
      "originalText": "반영 중단?",
      "lineHeight": 1.25
    },
    {
      "id": "text-abort",
      "type": "text",
      "x": 1504.5,
      "y": 122.0,
      "width": 151.0,
      "height": 50.0,
      "angle": 0,
      "strokeColor": "#0f172a",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 1,
      "strokeStyle": "solid",
      "roughness": 0,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": null,
      "seed": 1661496455,
      "version": 1,
      "versionNonce": 1800181665,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1760000000000,
      "link": null,
      "locked": false,
      "text": "HTTP ×3\n중단 기록·오류·알림",
      "fontSize": 20,
      "fontFamily": 2,
      "textAlign": "center",
      "verticalAlign": "middle",
      "baseline": 41.4,
      "containerId": "node-abort",
      "originalText": "HTTP ×3\n중단 기록·오류·알림",
      "lineHeight": 1.25
    },
    {
      "id": "text-loop",
      "type": "text",
      "x": 1183.5,
      "y": 362.0,
      "width": 73.0,
      "height": 50.0,
      "angle": 0,
      "strokeColor": "#0f172a",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 1,
      "strokeStyle": "solid",
      "roughness": 0,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": null,
      "seed": 1437653784,
      "version": 1,
      "versionNonce": 1234674309,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1760000000000,
      "link": null,
      "locked": false,
      "text": "Loop\n건별 반영",
      "fontSize": 20,
      "fontFamily": 2,
      "textAlign": "center",
      "verticalAlign": "middle",
      "baseline": 41.4,
      "containerId": "node-loop",
      "originalText": "Loop\n건별 반영",
      "lineHeight": 1.25
    },
    {
      "id": "text-write",
      "type": "text",
      "x": 1512.5,
      "y": 339.5,
      "width": 135.0,
      "height": 75.0,
      "angle": 0,
      "strokeColor": "#0f172a",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 1,
      "strokeStyle": "solid",
      "roughness": 0,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": null,
      "seed": 1663582636,
      "version": 1,
      "versionNonce": 711572648,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1760000000000,
      "link": null,
      "locked": false,
      "text": "HTTP PATCH\n사본 반영\n실패 → 오류 출력",
      "fontSize": 20,
      "fontFamily": 2,
      "textAlign": "center",
      "verticalAlign": "middle",
      "baseline": 66.4,
      "containerId": "node-write",
      "originalText": "HTTP PATCH\n사본 반영\n실패 → 오류 출력",
      "lineHeight": 1.25
    },
    {
      "id": "text-mark",
      "type": "text",
      "x": 1784.0,
      "y": 362.0,
      "width": 112.0,
      "height": 50.0,
      "angle": 0,
      "strokeColor": "#0f172a",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 1,
      "strokeStyle": "solid",
      "roughness": 0,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": null,
      "seed": 1462595242,
      "version": 1,
      "versionNonce": 1138130665,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1760000000000,
      "link": null,
      "locked": false,
      "text": "Set\n완료·실패 표시",
      "fontSize": 20,
      "fontFamily": 2,
      "textAlign": "center",
      "verticalAlign": "middle",
      "baseline": 41.4,
      "containerId": "node-mark",
      "originalText": "Set\n완료·실패 표시",
      "lineHeight": 1.25
    },
    {
      "id": "text-summary",
      "type": "text",
      "x": 1183.5,
      "y": 582.0,
      "width": 73.0,
      "height": 50.0,
      "angle": 0,
      "strokeColor": "#0f172a",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 1,
      "strokeStyle": "solid",
      "roughness": 0,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": null,
      "seed": 78594031,
      "version": 1,
      "versionNonce": 583394953,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1760000000000,
      "link": null,
      "locked": false,
      "text": "Code\n결과 요약",
      "fontSize": 20,
      "fontFamily": 2,
      "textAlign": "center",
      "verticalAlign": "middle",
      "baseline": 41.4,
      "containerId": "node-summary",
      "originalText": "Code\n결과 요약",
      "lineHeight": 1.25
    },
    {
      "id": "text-save",
      "type": "text",
      "x": 1506.5,
      "y": 582.0,
      "width": 147.0,
      "height": 50.0,
      "angle": 0,
      "strokeColor": "#0f172a",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 1,
      "strokeStyle": "solid",
      "roughness": 0,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": null,
      "seed": 1848085306,
      "version": 1,
      "versionNonce": 474784078,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1760000000000,
      "link": null,
      "locked": false,
      "text": "HTTP\n동기화 기록 + 알림",
      "fontSize": 20,
      "fontFamily": 2,
      "textAlign": "center",
      "verticalAlign": "middle",
      "baseline": 41.4,
      "containerId": "node-save",
      "originalText": "HTTP\n동기화 기록 + 알림",
      "lineHeight": 1.25
    },
    {
      "id": "text-errs",
      "type": "text",
      "x": 1145.5,
      "y": 762.0,
      "width": 129.0,
      "height": 50.0,
      "angle": 0,
      "strokeColor": "#0f172a",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 1,
      "strokeStyle": "solid",
      "roughness": 0,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": null,
      "seed": 1909074451,
      "version": 1,
      "versionNonce": 1680125942,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1760000000000,
      "link": null,
      "locked": false,
      "text": "Code + HTTP\n자동화 오류 기록",
      "fontSize": 20,
      "fontFamily": 2,
      "textAlign": "center",
      "verticalAlign": "middle",
      "baseline": 41.4,
      "containerId": "node-errs",
      "originalText": "Code + HTTP\n자동화 오류 기록",
      "lineHeight": 1.25
    },
    {
      "id": "title",
      "type": "text",
      "x": 0,
      "y": 0.0,
      "width": 429.0,
      "height": 35.0,
      "angle": 0,
      "strokeColor": "#0f172a",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 1,
      "strokeStyle": "solid",
      "roughness": 0,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": null,
      "seed": 159451258,
      "version": 1,
      "versionNonce": 1971650405,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1760000000000,
      "link": null,
      "locked": false,
      "text": "n8n 판 — 같은 판정을 노코드 흐름으로",
      "fontSize": 28,
      "fontFamily": 2,
      "textAlign": "left",
      "verticalAlign": "top",
      "baseline": 22.96,
      "containerId": null,
      "originalText": "n8n 판 — 같은 판정을 노코드 흐름으로",
      "lineHeight": 1.25
    },
    {
      "id": "subtitle",
      "type": "text",
      "x": 0,
      "y": 41.0,
      "width": 835.0,
      "height": 20.0,
      "angle": 0,
      "strokeColor": "#64748b",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 1,
      "strokeStyle": "solid",
      "roughness": 0,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": null,
      "seed": 1919961959,
      "version": 1,
      "versionNonce": 869340623,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1760000000000,
      "link": null,
      "locked": false,
      "text": "Code 노드의 판정이 에어테이블 스크립트와 같은지 테스트한다. 쓰기 실패는 HTTP 노드의 오류 출력으로 갈라져 나머지는 계속 반영",
      "fontSize": 16,
      "fontFamily": 2,
      "textAlign": "left",
      "verticalAlign": "top",
      "baseline": 13.12,
      "containerId": null,
      "originalText": "Code 노드의 판정이 에어테이블 스크립트와 같은지 테스트한다. 쓰기 실패는 HTTP 노드의 오류 출력으로 갈라져 나머지는 계속 반영",
      "lineHeight": 1.25
    }
  ],
  "appState": {
    "gridSize": null,
    "viewBackgroundColor": "#ffffff"
  },
  "files": {}
}
```
%%
# Text Elements
예 ^label-edge-gate-abort-4
아니오 ^label-edge-gate-loop-5
쓸 건 ^label-edge-loop-write-6
끝 ^label-edge-loop-summary-9
Schedule
매시 실행 ^text-sched
Code
동기화 설정 ^text-cfg
HTTP ×3
직전 기록·허브 원본
·사본 조회 ^text-get
Code
반영 계획
급감 검사·planSync ^text-plan
반영 중단? ^text-gate
HTTP ×3
중단 기록·오류·알림 ^text-abort
Loop
건별 반영 ^text-loop
HTTP PATCH
사본 반영
실패 → 오류 출력 ^text-write
Set
완료·실패 표시 ^text-mark
Code
결과 요약 ^text-summary
HTTP
동기화 기록 + 알림 ^text-save
Code + HTTP
자동화 오류 기록 ^text-errs
n8n 판 — 같은 판정을 노코드 흐름으로 ^title
Code 노드의 판정이 에어테이블 스크립트와 같은지 테스트한다. 쓰기 실패는 HTTP 노드의 오류 출력으로 갈라져 나머지는 계속 반영 ^subtitle
%%
