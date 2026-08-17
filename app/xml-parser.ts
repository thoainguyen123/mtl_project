export type ParsedProjectData = {
  customTasks: any[];
  taskEdits: Record<string, any>;
  taskDependencies: Record<string, any[]>;
};

export async function parseMSProjectXML(xmlString: string): Promise<ParsedProjectData> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, "application/xml");
  
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error("Tệp XML không hợp lệ.");
  }

  const tasks = Array.from(doc.querySelectorAll("Project > Tasks > Task"));
  
  const customTasks: any[] = [];
  const taskEdits: Record<string, any> = {};
  const taskDependencies: Record<string, any[]> = {};
  
  // Mapping UID to Code for dependencies
  const uidToCode: Record<string, string> = {};
  
  // First pass: build tasks
  for (const task of tasks) {
    const uid = task.querySelector("UID")?.textContent;
    if (!uid) continue;
    
    // Ignore empty/null tasks
    const isNull = task.querySelector("IsNull")?.textContent === "1" || task.querySelector("IsNull")?.textContent === "true";
    if (isNull) continue;

    const name = task.querySelector("Name")?.textContent || "Unnamed Task";
    
    // MS Project outline level starts at 1
    const outlineLevel = parseInt(task.querySelector("OutlineLevel")?.textContent || "1", 10);
    const summary = task.querySelector("Summary")?.textContent === "1" || task.querySelector("Summary")?.textContent === "true";
    
    const code = `XML-${uid}`;
    uidToCode[uid] = code;
    
    // Extract dates
    const startStr = task.querySelector("Start")?.textContent;
    const finishStr = task.querySelector("Finish")?.textContent;
    const startDate = startStr ? startStr.split("T")[0] : undefined;
    const endDate = finishStr ? finishStr.split("T")[0] : undefined;
    
    // Calculate simple duration in days
    let duration = 1;
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      duration = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
    }
    
    customTasks.push({
      id: parseInt(uid, 10),
      code,
      parentCode: null, // We'll compute this next
      groupCode: "9.1", // assign a default group from GROUPS
      name,
      level: outlineLevel,
      summary,
      defaultDuration: duration,
      custom: true,
    });
    
    if (startDate || endDate) {
      taskEdits[code] = {
        startDate,
        endDate,
        duration,
        status: "Đang thực hiện"
      };
    }
  }
  
  // Second pass: compute parents based on OutlineLevel
  const levelToCode: Record<number, string> = {};
  for (const task of customTasks) {
    levelToCode[task.level] = task.code;
    if (task.level > 1) {
      task.parentCode = levelToCode[task.level - 1] || null;
    }
  }
  
  // Third pass: dependencies
  for (const task of tasks) {
    const uid = task.querySelector("UID")?.textContent;
    if (!uid) continue;
    const succCode = uidToCode[uid];
    if (!succCode) continue;
    
    const links = Array.from(task.querySelectorAll("PredecessorLink"));
    const deps = [];
    
    for (const link of links) {
      const predUid = link.querySelector("PredecessorUID")?.textContent;
      if (!predUid) continue;
      const predCode = uidToCode[predUid];
      if (!predCode) continue;
      
      const typeNum = link.querySelector("Type")?.textContent || "1";
      // MS Project types: 0=FF, 1=FS, 2=SF, 3=SS
      let type = "FS";
      if (typeNum === "0") type = "FF";
      if (typeNum === "2") type = "SF";
      if (typeNum === "3") type = "SS";
      
      const lagStr = link.querySelector("LinkLag")?.textContent || "0";
      // LinkLag is in tenths of a minute (e.g. 4800 = 480 mins = 8 hours = 1 day)
      // For simplicity, convert assuming 4800 = 1 day
      const lagDays = Math.round(parseInt(lagStr, 10) / 4800);
      
      deps.push({
        predecessorCode: predCode,
        type,
        lagDays
      });
    }
    
    if (deps.length > 0) {
      taskDependencies[succCode] = deps;
    }
  }
  
  return { customTasks, taskEdits, taskDependencies };
}
