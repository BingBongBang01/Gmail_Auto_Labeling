// bg/features/backup/index.js
// Drive 백업/복원 기능의 등록부.

import { registerAction } from "../../core/message_router.js";
import { registerJob } from "../../core/job_registry.js";
import { processBackupToDrive, processRestoreFromDrive } from "./backup.js";

function register() {
  // ----- 백업 -----
  registerJob("drive_backup", {
    jobKind: "driveBackup",
    notifyTitleKey: "notifyTitleDriveBackup",
    resolve: (payload, settings) => {
      // 예전에는 includeCredentials를 무조건 false로, 암호는 빈 문자열로 넘겨서
      // 설정의 "자격 증명 포함" 옵션과 암호 입력이 전혀 반영되지 않았다.
      const includeCredentials =
        payload.includeCredentials !== undefined
          ? !!payload.includeCredentials
          : settings.data?.backup?.includeCredentials === true;
      return {
        run: () => processBackupToDrive(includeCredentials, payload.passphrase || ""),
        response: { ok: true, started: true, messageKey: "driveBackupRequesting" },
      };
    },
  });

  registerJob("drive_restore", {
    jobKind: "driveRestore",
    notifyTitleKey: "notifyTitleDriveRestore",
    resolve: (payload) => ({
      run: () => processRestoreFromDrive(payload.passphrase || ""),
      response: { ok: true, started: true, messageKey: "driveRestoreRequesting" },
    }),
  });

  registerAction("getLastDriveBackupInfo", async () => {
    const result = await chrome.storage.local.get(["lastDriveBackupAt"]);
    return { lastDriveBackupAt: result.lastDriveBackupAt || null };
  });
}

export { register };
