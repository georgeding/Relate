; Inno Setup script for the Relate Windows installer. Built by `node desktop/build.mjs`, which stages
; node.exe + the app into dist\stage and passes the version in. Per-user install, no admin needed.
; Your data lives in %APPDATA%\Relate and is never touched by upgrades or uninstall.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef Stage
  #define Stage "..\dist\stage"
#endif

[Setup]
AppId={{6F0C1E53-9A3B-4B7E-9E2C-5B1D7A0F4C21}
AppName=Relate
AppVersion={#AppVersion}
AppVerName=Relate {#AppVersion}
AppPublisher=Relate
DefaultDirName={localappdata}\Programs\Relate
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=RelateSetup-{#AppVersion}
SetupIconFile={#Stage}\relate.ico
UninstallDisplayIcon={app}\relate.ico
UninstallDisplayName=Relate
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
LicenseFile=..\LICENSE
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=no

[Languages]
; Chinese first; the wizard picks the one matching the Windows display language
; (ChineseSimplified.isl is the Inno Setup project's user-contributed translation, vendored here)
Name: "zh"; MessagesFile: "ChineseSimplified.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "autostart"; Description: "Start Relate in the background when I sign in / 登录时在后台启动 Relate"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#Stage}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[InstallDelete]
; a clean app folder on upgrade (user data is elsewhere)
Type: filesandordirs; Name: "{app}\app"

[Icons]
Name: "{autoprograms}\Relate"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\Relate.vbs"""; IconFilename: "{app}\relate.ico"; Comment: "Open Relate"
Name: "{autoprograms}\Stop Relate"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\Relate.vbs"" --stop"; IconFilename: "{app}\relate.ico"
Name: "{autodesktop}\Relate"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\Relate.vbs"""; IconFilename: "{app}\relate.ico"; Tasks: desktopicon
Name: "{userstartup}\Relate"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\Relate.vbs"" --background"; IconFilename: "{app}\relate.ico"; Tasks: autostart

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\Relate.vbs"""; Description: "Open Relate now / 立即打开 Relate"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "{app}\node\node.exe"; Parameters: """{app}\app\desktop\launcher.mjs"" --stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopRelate"

[Code]
// stop a running hub before files are replaced on upgrade
function PrepareToInstall(var NeedsRestart: Boolean): String;
var Code: Integer;
begin
  if FileExists(ExpandConstant('{app}\node\node.exe')) then
    Exec(ExpandConstant('{app}\node\node.exe'), '"' + ExpandConstant('{app}\app\desktop\launcher.mjs') + '" --stop', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Result := '';
end;
