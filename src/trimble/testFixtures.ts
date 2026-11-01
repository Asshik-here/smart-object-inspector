/**
 * Synthetic test data (not from any real project): a small Tekla-style IFC with one rebar group of four
 * bars, and the matching viewer data. The group is placed with a 90° rotation inside a translated parent
 * placement, so tests cover the full placement chain.
 *
 * Bars run along world Y (800 mm long) and sit at world X = 1100, 990, 790, 590 (Y = 2000, Z = 0):
 * spacing 110 · 200 · 200 when read from the max side.
 */
import type { ObjectProperties } from "trimble-connect-workspace-api";

export const GROUP_GUID = "2TestGroup0000000000AB";

export const IFC_FIXTURE = `ISO-10303-21;
HEADER;
FILE_SCHEMA(('IFC2X3'));
ENDSEC;
DATA;
#1= IFCCARTESIANPOINT((0.,0.,0.));
#2= IFCDIRECTION((0.,0.,1.));
#3= IFCDIRECTION((1.,0.,0.));
#4= IFCDIRECTION((0.,1.,0.));
#5= IFCOWNERHISTORY($,$,$,.NOCHANGE.,$,$,$,0);
#10= IFCAXIS2PLACEMENT3D(#11,$,$);
#11= IFCCARTESIANPOINT((1000.,2000.,0.));
#12= IFCLOCALPLACEMENT($,#10);
#20= IFCAXIS2PLACEMENT3D(#21,#2,#4);
#21= IFCCARTESIANPOINT((100.,0.,0.));
#23= IFCLOCALPLACEMENT(#12,#20);
#30= IFCLINE(#1,#31);
#31= IFCVECTOR(#3,1.);
#33= IFCTRIMMEDCURVE(#30,(IFCPARAMETERVALUE(0.)),(IFCPARAMETERVALUE(800.)),.T.,.PARAMETER.);
#34= IFCCOMPOSITECURVESEGMENT(.CONTINUOUS.,.T.,#33);
#35= IFCCOMPOSITECURVE((#34),.F.);
#36= IFCSWEPTDISKSOLID(#35,5.,$,0.,800.);
#37= IFCSHAPEREPRESENTATION(#40,'Body','AdvancedSweptSolid',(#36));
#38= IFCREPRESENTATIONMAP(#39,#37);
#39= IFCAXIS2PLACEMENT3D(#1,$,$);
#50= IFCCARTESIANPOINT((0.,0.,0.));
#51= IFCCARTESIANTRANSFORMATIONOPERATOR3D($,$,#50,$,$);
#52= IFCMAPPEDITEM(#38,#51);
#53= IFCCARTESIANPOINT((0.,110.,0.));
#54= IFCCARTESIANTRANSFORMATIONOPERATOR3D($,$,#53,$,$);
#55= IFCMAPPEDITEM(#38,#54);
#56= IFCCARTESIANPOINT((0.,310.,0.));
#57= IFCCARTESIANTRANSFORMATIONOPERATOR3D($,$,#56,$,$);
#58= IFCMAPPEDITEM(#38,#57);
#59= IFCCARTESIANPOINT((0.,510.,0.));
#60= IFCCARTESIANTRANSFORMATIONOPERATOR3D($,$,#59,$,$);
#61= IFCMAPPEDITEM(#38,#60);
#70= IFCSHAPEREPRESENTATION(#40,'Body','MappedRepresentation',
  (#52,#55,#58,#61));
#71= IFCPRODUCTDEFINITIONSHAPE($,$,(#70));
#80= IFCREINFORCINGBAR('${GROUP_GUID}',#5,'B9 ''PF''',$,$,#23,#71,'IDtest',$,10.,0.,$,.NOTDEFINED.,$);
ENDSEC;
END-ISO-10303-21;
`;

/** Expected bar positions (world mm) for the fixture. */
export const FIXTURE_BAR_X = [1100, 990, 790, 590];

const prop = (name: string, value: string | number) => ({ name, value, type: typeof value === "number" ? 0 : 5 });

/** Viewer properties for the fixture group, in the MSS_TEST_BBS_PS layout. */
export const GROUP_PROPERTIES: ObjectProperties = {
  id: 1,
  class: "IFCREINFORCINGBAR",
  product: { name: "B9 PF" },
  properties: [
    { name: "IfcReinforcingBar", properties: [prop("NominalDiameter", 10)] },
    {
      name: "MSS_TEST_BBS_PS",
      properties: [
        prop("BAR / PART NAME", "B9 PF"),
        prop("REBAR BARMARK", "99"),
        prop("GRADE", "H"),
        prop("SIZE", "10"),
        prop("NUMBER OF BARS IN GROUP", 4),
        prop("DIM X (ACTUAL LENGTH)", 800),
      ],
    },
  ] as ObjectProperties["properties"],
};

/** Viewer bounding box (meters) of the fixture group: bar centrelines plus the 5 mm bar radius. */
export const GROUP_BOX = {
  isBox3: true,
  min: { x: 0.585, y: 1.995, z: -0.005 },
  max: { x: 1.105, y: 2.805, z: 0.005 },
};
