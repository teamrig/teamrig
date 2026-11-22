import { EXIT_WAIT_MS } from '../../../plugin-api/index.ts';

/**
 * The two Windows PowerShell 5.1 scripts over UI Automation, no package needed, by which teamrig acts on Windows
 * Terminal's tabs: one opens a tab and leaves the focus where it was, one brings a tab to the front. Nothing is typed
 * into a terminal, and what a script acts on reaches it as a variable, never inside it.
 */

/** The variable the focus script reads the tab's title from. */
export const FOCUS_TITLE_VAR = 'TEAMRIG_FOCUS_TITLE';

/** The focus script's exit codes past 0 (selected and raised): no tab of that title, the tab selected behind another app's window. Any other: the script failed. */
export const FOCUS_EXIT = { noTab: 3, behind: 4 } as const;

/** How long the focus script waits to see the raised window take the focus, in tries 100 ms apart. */
const RAISE_TRIES = 10;

/**
 * It selects the first Windows Terminal tab whose name is the title or ends with a space and the title (after any mark
 * the session's program puts before its title), restores its window when minimized and gives it the focus. Windows'
 * foreground lock may keep another app's window in front: the tab is then selected in its window, and the script
 * exits FOCUS_EXIT.behind.
 */
export const FOCUS_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  // Its first module load writes a progress record, which reaches a caller's stderr as CLIXML.
  "$ProgressPreference = 'SilentlyContinue'",
  'try {',
  '  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes',
  '  $element = [System.Windows.Automation.AutomationElement]',
  '  $scope = [System.Windows.Automation.TreeScope]',
  `  $title = $env:${FOCUS_TITLE_VAR}`,
  "  $windows = $element::RootElement.FindAll($scope::Children, [System.Windows.Automation.PropertyCondition]::new($element::ClassNameProperty, 'CASCADIA_HOSTING_WINDOW_CLASS'))",
  '  $tabItem = [System.Windows.Automation.PropertyCondition]::new($element::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)',
  '  foreach ($window in $windows) {',
  '    foreach ($tab in $window.FindAll($scope::Descendants, $tabItem)) {',
  '      $name = $tab.Current.Name',
  "      if ($name -cne $title -and -not $name.EndsWith(' ' + $title, [StringComparison]::Ordinal)) { continue }",
  '      $tab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()',
  '      $shape = $window.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)',
  '      if ($shape.Current.WindowVisualState -eq [System.Windows.Automation.WindowVisualState]::Minimized) { $shape.SetWindowVisualState([System.Windows.Automation.WindowVisualState]::Normal) }',
  '      try { $window.SetFocus() } catch { }',
  '      $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker',
  `      for ($try = 0; $try -lt ${RAISE_TRIES}; $try++) {`,
  '        $top = $element::FocusedElement',
  '        while ($top -ne $null) {',
  '          $parent = $walker.GetParent($top)',
  '          if ($parent -eq $null -or [System.Windows.Automation.Automation]::Compare($parent, $element::RootElement)) { break }',
  '          $top = $parent',
  '        }',
  '        if ($top -ne $null -and [System.Windows.Automation.Automation]::Compare($top, $window)) { exit 0 }',
  '        Start-Sleep -Milliseconds 100',
  '      }',
  `      exit ${FOCUS_EXIT.behind}`,
  '    }',
  '  }',
  `  exit ${FOCUS_EXIT.noTab}`,
  '} catch {',
  '  exit 1',
  '}',
].join('\n');

/** The variable the keep-focus script reads the launcher's program from. */
export const KEEP_FOCUS_PROGRAM_VAR = 'TEAMRIG_KEEP_FOCUS_PROGRAM';
/** The variable the keep-focus script reads the launcher's arguments from, as one Windows command line (windowsCommandLine). */
export const KEEP_FOCUS_ARGS_VAR = 'TEAMRIG_KEEP_FOCUS_ARGS';

/**
 * The keep-focus script's exit codes past 0 (opened, focus kept): the launcher still running after the wait, the tab
 * opened but the focus not given back, the launcher not installed, the launcher exited with an error. Any other code:
 * the script itself failed.
 */
export const KEEP_FOCUS_EXIT = { running: 10, focusLost: 11, missing: 12, launcherFailed: 13 } as const;

/** How long the keep-focus script waits for the new tab to show, and then for the front window to take the focus back, in tries 100 ms apart. */
const NEW_TAB_TRIES = 30;
const REFOCUS_TRIES = 10;

/**
 * `wt.exe new-tab` always selects the new tab and raises its window, and has no flag against it (T2510). So this
 * script records the window in front and the selected tab of every Windows Terminal window, starts the launcher, waits
 * for the new tab, then selects those tabs again and gives the front window the focus back. Windows' foreground lock
 * may refuse that last step; the tabs are reselected all the same.
 */
export const KEEP_FOCUS_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  // Its first module load writes a progress record, which reaches a caller's stderr as CLIXML.
  "$ProgressPreference = 'SilentlyContinue'",
  'try {',
  '  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes',
  '  $element = [System.Windows.Automation.AutomationElement]',
  '  $scope = [System.Windows.Automation.TreeScope]',
  '  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker',
  '  $selectionItem = [System.Windows.Automation.SelectionItemPattern]::Pattern',
  "  $isTerminal = [System.Windows.Automation.PropertyCondition]::new($element::ClassNameProperty, 'CASCADIA_HOSTING_WINDOW_CLASS')",
  '  $tabItem = [System.Windows.Automation.PropertyCondition]::new($element::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)',
  // The top-level window holding the focus: the focused element, walked up to a child of the desktop.
  '  function Get-FrontWindow {',
  '    $top = $element::FocusedElement',
  '    while ($top -ne $null) {',
  '      $parent = $walker.GetParent($top)',
  '      if ($parent -eq $null -or [System.Windows.Automation.Automation]::Compare($parent, $element::RootElement)) { break }',
  '      $top = $parent',
  '    }',
  '    return $top',
  '  }',
  '  function Find-Tabs {',
  '    $tabs = [System.Collections.Generic.List[System.Windows.Automation.AutomationElement]]::new()',
  '    foreach ($window in $element::RootElement.FindAll($scope::Children, $isTerminal)) {',
  '      foreach ($tab in $window.FindAll($scope::Descendants, $tabItem)) { $tabs.Add($tab) }',
  '    }',
  '    return ,$tabs',
  '  }',
  // A failed record (a secure desktop in front, say) still opens the tab, with nothing to give back.
  '  $front = $null',
  '  $selected = [System.Collections.Generic.List[System.Windows.Automation.AutomationElement]]::new()',
  '  $before = 0',
  '  try {',
  '    $front = Get-FrontWindow',
  '    $tabs = Find-Tabs',
  '    $before = $tabs.Count',
  '    foreach ($tab in $tabs) { if ($tab.GetCurrentPattern($selectionItem).Current.IsSelected) { $selected.Add($tab) } }',
  '  } catch { $front = $null; $selected.Clear() }',
  `  $start = [System.Diagnostics.ProcessStartInfo]::new($env:${KEEP_FOCUS_PROGRAM_VAR}, $env:${KEEP_FOCUS_ARGS_VAR})`,
  '  $start.UseShellExecute = $false',
  '  try { $launcher = [System.Diagnostics.Process]::Start($start) } catch {',
  '    $base = $_.Exception.GetBaseException()',
  `    if ($base -is [System.ComponentModel.Win32Exception] -and $base.NativeErrorCode -eq 2) { exit ${KEEP_FOCUS_EXIT.missing} }`,
  `    exit ${KEEP_FOCUS_EXIT.launcherFailed}`,
  '  }',
  '  $code = 0',
  `  if (-not $launcher.WaitForExit(${EXIT_WAIT_MS})) { $code = ${KEEP_FOCUS_EXIT.running} } elseif ($launcher.ExitCode -ne 0) { exit ${KEEP_FOCUS_EXIT.launcherFailed} }`,
  '  if ($front -eq $null -and $selected.Count -eq 0) { exit $code }',
  `  for ($try = 0; $try -lt ${NEW_TAB_TRIES}; $try++) { if ((Find-Tabs).Count -gt $before) { break }; Start-Sleep -Milliseconds 100 }`,
  '  foreach ($tab in $selected) { try { $tab.GetCurrentPattern($selectionItem).Select() } catch { } }',
  '  if ($front -ne $null) {',
  '    try { $front.SetFocus() } catch { }',
  `    for ($try = 0; $try -lt ${REFOCUS_TRIES}; $try++) {`,
  '      $top = Get-FrontWindow',
  '      if ($top -ne $null -and [System.Windows.Automation.Automation]::Compare($top, $front)) { exit $code }',
  '      Start-Sleep -Milliseconds 100',
  '    }',
  `    if ($code -eq 0) { exit ${KEEP_FOCUS_EXIT.focusLost} }`,
  '  }',
  '  exit $code',
  '} catch {',
  '  exit 1',
  '}',
].join('\n');
