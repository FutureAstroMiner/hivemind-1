import hivemind from 'hivemind';
import minCut from 'utils/mincut';
import RoomVariationBuilderBase from 'room/planner/variation-builder-base';
import utilities from 'utilities';

type ExitCoords = {
  [dir: string]: RoomPosition[];
}

interface ScoredTowerPosition {
  pos: RoomPosition,
  score: number,
}

export default class RoomVariationBuilder extends RoomVariationBuilderBase {
  exitCoords: ExitCoords;
  exitCenters: ExitCoords;
  roomCenter: RoomPosition;
  roomCenterEntrances: RoomPosition[];
  private sourceInfo: {
    [id: string]: {
      harvestPosition: RoomPosition;
    };
  };
  private steps: (() => StepResult)[];

  safetyMatrix: CostMatrix;

  constructor(roomName: string, variation: string, wallMatrix: CostMatrix, exitMatrix: CostMatrix) {
    super(roomName, variation, wallMatrix, exitMatrix);
    hivemind.log('rooms', this.roomName).info('Started generating room plan for variation', variation);

    this.steps = [
      this.gatherExitCoords,
      this.determineCorePosition,
      this.determineHarvesterPositions,
      this.determineUpgraderPosition,
      this.placeRoadNetwork,
      this.placeHarvestBayStructures,
      this.placeRoomCore,
      this.placeHelperParkingLot,
      this.placeBays,
      this.placeLabs,
      this.placeHighLevelStructures,
      // @todo Protect positions for mincut
      this.placeRamparts,
      this.placeTowers,
      this.placeSpawnWalls,
    ];
  }

  buildStep(step: number): StepResult {
    if (step < this.steps.length) {
      hivemind.log('rooms', this.roomName).debug('Running step:', this.steps[step].name);
      return this.steps[step].call(this);
    }

    return 'done';
  }

  gatherExitCoords(): StepResult {
    // Prepare exit points.
    this.exitCoords = this.getExitCoordsByDirection();
    this.exitCenters = this.findExitCenters();

    for (const dir of _.keys(this.exitCoords)) {
      for (const pos of this.exitCenters[dir]) {
        this.placementManager.planLocation(pos, 'exit', null);
      }
    }

    return 'ok';
  }

  getExitCoordsByDirection(): ExitCoords {
    const exitCoords: ExitCoords = {
      N: [],
      S: [],
      W: [],
      E: [],
    };

    for (let i = 1; i < 49; i++) {
      if (this.terrain.get(0, i) !== TERRAIN_MASK_WALL) exitCoords.W.push(new RoomPosition(0, i, this.roomName));
      if (this.terrain.get(49, i) !== TERRAIN_MASK_WALL) exitCoords.E.push(new RoomPosition(49, i, this.roomName));
      if (this.terrain.get(i, 0) !== TERRAIN_MASK_WALL) exitCoords.N.push(new RoomPosition(i, 0, this.roomName));
      if (this.terrain.get(i, 49) !== TERRAIN_MASK_WALL) exitCoords.S.push(new RoomPosition(i, 49, this.roomName));
    }

    return exitCoords;
  }

  /**
   * Finds center positions of all room exits.
   *
   * @return {object}
   *   Array of RoomPosition objects, keyed by exit direction.
   */
  findExitCenters(): ExitCoords {
    const exitCenters: ExitCoords = {};

    for (const dir of _.keys(this.exitCoords)) {
      exitCenters[dir] = [];

      let startPos = null;
      let prevPos = null;
      for (const pos of this.exitCoords[dir]) {
        if (!startPos) {
          startPos = pos;
        }

        if (prevPos && pos.getRangeTo(prevPos) > 1) {
          // New exit block started.
          const middlePos = new RoomPosition(Math.ceil((prevPos.x + startPos.x) / 2), Math.ceil((prevPos.y + startPos.y) / 2), this.roomName);
          exitCenters[dir].push(middlePos);

          startPos = pos;
        }

        prevPos = pos;
      }

      if (startPos) {
        // Finish last wall run.
        const middlePos = new RoomPosition(Math.ceil((prevPos.x + startPos.x) / 2), Math.ceil((prevPos.y + startPos.y) / 2), this.roomName);
        exitCenters[dir].push(middlePos);
      }
    }

    return exitCenters;
  };

  determineCorePosition(): StepResult {
    const potentialCorePositions = this.collectPotentialCorePositions();
    const roomCenter = this.chooseCorePosition(potentialCorePositions);
    if (!roomCenter) return 'failed';

    this.roomCenter = roomCenter;

    // Center is accessible via the 4 cardinal directions.
    this.roomCenterEntrances = [
      new RoomPosition(roomCenter.x + 2, roomCenter.y, this.roomName),
      new RoomPosition(roomCenter.x - 2, roomCenter.y, this.roomName),
      new RoomPosition(roomCenter.x, roomCenter.y + 2, this.roomName),
      new RoomPosition(roomCenter.x, roomCenter.y - 2, this.roomName),
    ];

    this.placementManager.planLocation(roomCenter, 'center', null);

    return 'ok';
  }

  collectPotentialCorePositions(): RoomPosition[] {
    const potentialCorePositions: RoomPosition[] = [];

    for (let x = 0; x < 50; x++) {
      for (let y = 0; y < 50; y++) {
        if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

        const wallDistance = this.placementManager.getWallDistance(x, y);
        const exitDistance = this.placementManager.getExitDistance(x, y);

        if (wallDistance >= 4 && wallDistance < 255 && exitDistance > 8) {
          potentialCorePositions.push(new RoomPosition(x, y, this.roomName));
        }
      }
    }

    return potentialCorePositions;
  }

  chooseCorePosition(potentialCorePositions: RoomPosition[]) {
    const roomIntel = hivemind.roomIntel(this.roomName);
    const controllerPosition = roomIntel.getControllerPosition();

    // Decide where room center should be by averaging exit positions.
    // @todo Try multiple room centers:
    // - Current version
    // - Near controller
    // - Between controller and a source
    // - Near any corner or side
    // @todo Then evaluate best result by:
    // - Upkeep costs (roads, ramparts)
    // - Path lengths (Bays, sources, controller)
    let cx = controllerPosition.x;
    let cy = controllerPosition.y;
    let count = 1;
    for (const dir of _.keys(this.exitCenters)) {
      for (const pos of this.exitCenters[dir]) {
        count++;
        cx += pos.x;
        cy += pos.y;
      }
    }
    // Also include source and mineral positions when determining room center.
    const mineralInfo = roomIntel.getMineralPosition();
    if (mineralInfo) {
      count++;
      cx += mineralInfo.x;
      cy += mineralInfo.y;
    }

    const sourceInfo = roomIntel.getSourcePositions();
    for (const source of sourceInfo) {
      count++;
      cx += source.x;
      cy += source.y;
    }

    cx = Math.floor(cx / count);
    cy = Math.floor(cy / count);

    // Find closest position with distance from walls around there.
    const roomCenter = (new RoomPosition(cx, cy, this.roomName)).findClosestByRange(potentialCorePositions);
    if (!roomCenter) {
      hivemind.log('rooms', this.roomName).error('Could not find a suitable center position!');
      return null;
    }

    return roomCenter;
  }

  determineHarvesterPositions(): StepResult {
    this.sourceInfo = {};
    const roomIntel = hivemind.roomIntel(this.roomName);
    for (const source of roomIntel.getSourcePositions()) {
      const harvestPosition = this.determineHarvestPositionForSource(source);
      this.placementManager.planLocation(harvestPosition, 'harvester', null);
      this.placementManager.planLocation(harvestPosition, 'bay_center', null);

      // Discourage roads through spots around harvest position.
      utilities.handleMapArea(harvestPosition.x, harvestPosition.y, (x, y) => {
        if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) return;

        this.placementManager.discouragePosition(x, y);
      });

      this.storeHarvestPosition(source, harvestPosition);
    }

    const mineral = roomIntel.getMineralPosition();
    const mineralPosition = new RoomPosition(mineral.x, mineral.y, this.roomName);
    this.placementManager.planLocation(mineralPosition, 'extractor');
    const mineralRoads = this.placementManager.scanAndAddRoad(mineralPosition, this.roomCenterEntrances);
    for (const pos of mineralRoads) {
      this.placementManager.planLocation(pos, 'road.mineral', null);
    }

    this.placeContainer(mineralRoads, 'mineral');

    this.storeHarvestPosition(mineral, mineralRoads[0]);

    return 'ok';
  }

  determineHarvestPositionForSource(source: {x: number; y: number}): RoomPosition {
    // Find adjacent space that will provide most building space.
    // @todo Reasonably handle sources that can be accessed from multiple
    // sides. For example by checking if theres more than 1 group of
    // unconnected free tiles.
    let bestPos;
    utilities.handleMapArea(source.x, source.y, (x, y) => {
      if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) return;

      let numFreeTiles = 0;
      utilities.handleMapArea(x, y, (x2, y2) => {
        if (this.terrain.get(x2, y2) === TERRAIN_MASK_WALL) return;
        if (!this.placementManager.isBuildableTile(x2, y2)) return;

        numFreeTiles++;
      });

      if (!bestPos || bestPos.numFreeTiles < numFreeTiles) {
        bestPos = {x, y, numFreeTiles};
      }
    });

    return new RoomPosition(bestPos.x, bestPos.y, this.roomName);
  }

  storeHarvestPosition(source: {id: string}, harvestPosition: RoomPosition) {
    // Make sure no other paths get led through harvester position.
    this.placementManager.blockPosition(harvestPosition.x, harvestPosition.y);

    // Setup memory for quick access to harvest spots.
    this.sourceInfo[source.id] = {
      harvestPosition,
    };
  }

  determineUpgraderPosition(): StepResult {
    const roomIntel = hivemind.roomIntel(this.roomName);
    const controllerPosition = roomIntel.getControllerPosition();
    const controllerRoads = this.placementManager.scanAndAddRoad(controllerPosition, this.roomCenterEntrances);

    // Make sure no other paths get led through upgrader position.
    this.placementManager.blockPosition(controllerRoads[0].x, controllerRoads[0].y);

    this.placeContainer(controllerRoads, 'controller');

    // Place a link near controller, but off the calculated path.
    this.placeLink(controllerRoads, 'controller');

    return 'ok';
  }

  placeRoadNetwork(): StepResult {
    // Find paths from each exit towards the room center for making roads.
    for (const dir of _.keys(this.exitCenters)) {
      for (const pos of this.exitCenters[dir]) {
        const exitRoads = this.placementManager.scanAndAddRoad(pos, this.roomCenterEntrances);
        for (const pos of exitRoads) {
          this.placementManager.planLocation(pos, 'road.exit', null);
        }
      }
    }

    // Add road to controller.
    // @todo Create road starting from room center, and only to range 3.
    const roomIntel = hivemind.roomIntel(this.roomName);
    const controllerPosition = roomIntel.getControllerPosition();
    const controllerRoads = this.placementManager.scanAndAddRoad(controllerPosition, this.roomCenterEntrances);
    for (const pos of controllerRoads) {
      this.placementManager.planLocation(pos, 'road.controller', null);
      this.protectPosition(pos, 0);
    }

    return 'ok';
  }

  placeHarvestBayStructures(): StepResult {
    const roomIntel = hivemind.roomIntel(this.roomName);
    for (const source of roomIntel.getSourcePositions()) {
      const harvestPosition = this.sourceInfo[source.id].harvestPosition;
      const sourceRoads = this.placementManager.scanAndAddRoad(harvestPosition, this.roomCenterEntrances);
      for (const pos of sourceRoads) {
        this.placementManager.planLocation(pos, 'road.source', null);
        this.protectPosition(pos, 0);
      }

      this.placementManager.planLocation(harvestPosition, 'container.source', null);
      this.placementManager.planLocation(harvestPosition, 'container', null);

      this.placeBayStructures(harvestPosition, {spawn: true, source: true});
    }

    return 'ok';
  }

  /**
   * Places structures that are fixed to the room's center.
   */
  placeRoomCore(): StepResult {
    // Fill center cross with roads.
    this.placementManager.planLocation(new RoomPosition(this.roomCenter.x - 1, this.roomCenter.y, this.roomName), 'road', 1);
    this.placementManager.planLocation(new RoomPosition(this.roomCenter.x + 1, this.roomCenter.y, this.roomName), 'road', 1);
    this.placementManager.planLocation(new RoomPosition(this.roomCenter.x, this.roomCenter.y - 1, this.roomName), 'road', 1);
    this.placementManager.planLocation(new RoomPosition(this.roomCenter.x, this.roomCenter.y + 1, this.roomName), 'road', 1);
    this.placementManager.planLocation(new RoomPosition(this.roomCenter.x, this.roomCenter.y, this.roomName), 'road', 1);

    // Mark center buildings for construction.
    this.placementManager.planLocation(new RoomPosition(this.roomCenter.x - 1, this.roomCenter.y + 1, this.roomName), 'storage');
    this.placementManager.planLocation(new RoomPosition(this.roomCenter.x - 1, this.roomCenter.y - 1, this.roomName), 'terminal');
    this.placementManager.planLocation(new RoomPosition(this.roomCenter.x + 1, this.roomCenter.y + 1, this.roomName), 'lab');
    this.placementManager.planLocation(new RoomPosition(this.roomCenter.x + 1, this.roomCenter.y + 1, this.roomName), 'lab.boost');
    this.placementManager.planLocation(new RoomPosition(this.roomCenter.x + 1, this.roomCenter.y - 1, this.roomName), 'link');
    this.placementManager.planLocation(new RoomPosition(this.roomCenter.x + 1, this.roomCenter.y - 1, this.roomName), 'link.storage');

    return 'ok';
  };

  /**
   * Places parking spot for helper creep.
   */
  placeHelperParkingLot(): StepResult {
    const nextPos = this.placementManager.getNextAvailableBuildSpot();
    if (!nextPos) return 'failed';

    this.placementManager.planLocation(nextPos, 'road', 255);
    this.placementManager.planLocation(nextPos, 'helper_parking');

    this.placementManager.placeAccessRoad(nextPos);

    this.placementManager.filterOpenList(utilities.encodePosition(nextPos));

    return 'ok';
  };

  /**
   * Places extension bays.
   */
  placeBays(): StepResult {
    this.placementManager.startBuildingPlacement(this.roomCenter, this.roomCenterEntrances);
    while (this.roomPlan.canPlaceMore('extension')) {
      const pos = this.findBayPosition();
      if (!pos) return 'failed';

      this.placementManager.placeAccessRoad(pos);

      // Make sure there is a road in the center of the bay.
      this.placementManager.planLocation(pos, 'road', 1);
      this.placementManager.planLocation(pos, 'bay_center', 1);

      this.placeBayStructures(pos, {spawn: true});

      // Reinitialize pathfinding.
      this.placementManager.startBuildingPlacement();
    }

    return 'ok';
  };

  /**
   * Finds best position to place a new bay at.
   *
   * @return {RoomPosition}
   *   The calculated position.
   */
  findBayPosition(): RoomPosition {
    let maxExtensions = 0;
    let bestPos = null;
    let bestScore = 0;

    while (maxExtensions < 8) {
      const nextPos = this.placementManager.getNextAvailableBuildSpot();
      if (!nextPos) break;

      // Don't build too close to exits.
      if (this.placementManager.getExitDistance(nextPos.x, nextPos.y) < 8) continue;

      if (!this.placementManager.isBuildableTile(nextPos.x, nextPos.y)) continue;

      // @todo One tile is allowed to be a road.
      // @todo Use a lenient stamper.
      let tileCount = 0;
      if (this.placementManager.isBuildableTile(nextPos.x - 1, nextPos.y)) tileCount++;
      if (this.placementManager.isBuildableTile(nextPos.x + 1, nextPos.y)) tileCount++;
      if (this.placementManager.isBuildableTile(nextPos.x, nextPos.y - 1)) tileCount++;
      if (this.placementManager.isBuildableTile(nextPos.x, nextPos.y + 1)) tileCount++;
      if (this.placementManager.isBuildableTile(nextPos.x - 1, nextPos.y - 1)) tileCount++;
      if (this.placementManager.isBuildableTile(nextPos.x + 1, nextPos.y - 1)) tileCount++;
      if (this.placementManager.isBuildableTile(nextPos.x - 1, nextPos.y + 1)) tileCount++;
      if (this.placementManager.isBuildableTile(nextPos.x + 1, nextPos.y + 1)) tileCount++;

      if (tileCount <= maxExtensions) continue;

      maxExtensions = tileCount;
      const score = tileCount / (this.placementManager.getCurrentBuildSpotInfo().range + 10);
      if (score > bestScore && tileCount >= 4) {
        bestPos = nextPos;
        bestScore = score;
      }
    }

    if (maxExtensions < 4) return null;

    return bestPos;
  };

  /**
   * Places labs in big compounds.
   */
  placeLabs() {
    this.placementManager.startBuildingPlacement();
    while (this.roomPlan.canPlaceMore('lab')) {
      const nextPos = this.placementManager.getNextAvailableBuildSpot();
      if (!nextPos) return 'failed';

      // Don't build too close to exits.
      if (this.placementManager.getExitDistance(nextPos.x, nextPos.y) < 8) continue;

      // @todo Dynamically generate lab layout for servers where 10 labs is not the max.
      // @todo Allow rotating this blueprint for better access.
      // @todo Use stamper.
      if (!this.placementManager.isBuildableTile(nextPos.x, nextPos.y)) continue;
      if (!this.placementManager.isBuildableTile(nextPos.x - 1, nextPos.y)) continue;
      if (!this.placementManager.isBuildableTile(nextPos.x + 1, nextPos.y)) continue;
      if (!this.placementManager.isBuildableTile(nextPos.x, nextPos.y - 1)) continue;
      if (!this.placementManager.isBuildableTile(nextPos.x, nextPos.y + 1)) continue;
      if (!this.placementManager.isBuildableTile(nextPos.x - 1, nextPos.y - 1)) continue;
      if (!this.placementManager.isBuildableTile(nextPos.x + 1, nextPos.y - 1)) continue;
      if (!this.placementManager.isBuildableTile(nextPos.x - 1, nextPos.y + 1)) continue;
      if (!this.placementManager.isBuildableTile(nextPos.x + 1, nextPos.y + 1)) continue;
      if (!this.placementManager.isBuildableTile(nextPos.x - 1, nextPos.y + 2)) continue;
      if (!this.placementManager.isBuildableTile(nextPos.x, nextPos.y + 2)) continue;
      if (!this.placementManager.isBuildableTile(nextPos.x + 1, nextPos.y + 2)) continue;

      // Place center area.
      this.placementManager.planLocation(new RoomPosition(nextPos.x - 1, nextPos.y, nextPos.roomName), 'lab');
      this.placementManager.planLocation(new RoomPosition(nextPos.x - 1, nextPos.y, nextPos.roomName), 'lab.reaction');
      this.placementManager.planLocation(new RoomPosition(nextPos.x, nextPos.y, nextPos.roomName), 'road', 1);

      this.placementManager.planLocation(new RoomPosition(nextPos.x + 1, nextPos.y, nextPos.roomName), 'lab');
      this.placementManager.planLocation(new RoomPosition(nextPos.x + 1, nextPos.y, nextPos.roomName), 'lab.reaction');
      this.placementManager.planLocation(new RoomPosition(nextPos.x - 1, nextPos.y + 1, nextPos.roomName), 'lab');
      this.placementManager.planLocation(new RoomPosition(nextPos.x - 1, nextPos.y + 1, nextPos.roomName), 'lab.reaction');
      this.placementManager.planLocation(new RoomPosition(nextPos.x, nextPos.y + 1, nextPos.roomName), 'road', 1);

      this.placementManager.planLocation(new RoomPosition(nextPos.x + 1, nextPos.y + 1, nextPos.roomName), 'lab');
      this.placementManager.planLocation(new RoomPosition(nextPos.x + 1, nextPos.y + 1, nextPos.roomName), 'lab.reaction');

      this.placementManager.placeAccessRoad(nextPos);

      // Add top and bottom buildings.
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 2; dy += 3) {
          if (this.placementManager.isBuildableTile(nextPos.x + dx, nextPos.y + dy)) {
            this.placementManager.planLocation(new RoomPosition(nextPos.x + dx, nextPos.y + dy, nextPos.roomName), 'lab');
            this.placementManager.planLocation(new RoomPosition(nextPos.x + dx, nextPos.y + dy, nextPos.roomName), 'lab.reaction');
          }
        }
      }

      // Reinitialize pathfinding.
      this.placementManager.startBuildingPlacement();
    }

    return 'ok';
  };

  placeHighLevelStructures(): StepResult {
    this.placementManager.placeAll('powerSpawn', true);
    this.placementManager.placeAll('nuker', true);
    this.placementManager.placeAll('observer', false);

    return 'ok';
  }

  placeRamparts(): StepResult {
    // Make sure the controller can't directly be reached by enemies.
    const roomIntel = hivemind.roomIntel(this.roomName);
    const safety = roomIntel.calculateAdjacentRoomSafety();

    this.protectPosition(roomIntel.getControllerPosition(), 1);

    for (const locationType of this.roomPlan.getPositionTypes()) {
      const baseType = locationType.split('.')[0];
      if (!CONTROLLER_STRUCTURES[baseType] || ['extension', 'road', 'container', 'extractor'].includes(baseType)) continue;

      // Protect area around essential structures.
      for (const pos of this.roomPlan.getPositions(locationType)) {
        this.protectPosition(pos);
      }
    }

    // Protect exits to safe rooms.
    const bounds: MinCutRect = {x1: 0, x2: 49, y1: 0, y2: 49};
    for (const exitDir of _.keys(safety.directions)) {
      if (!safety.directions[exitDir]) continue;

      if (exitDir === 'N') bounds.protectTopExits = true;
      if (exitDir === 'S') bounds.protectBottomExits = true;
      if (exitDir === 'W') bounds.protectLeftExits = true;
      if (exitDir === 'E') bounds.protectRightExits = true;
    }

    const potentialWallPositions: RoomPosition[] = [];
    const rampartCoords = minCut.getCutTiles(this.roomName, this.minCutBounds, bounds);
    for (const coord of rampartCoords) {
      potentialWallPositions.push(new RoomPosition(coord.x, coord.y, this.roomName));
    }

    this.pruneWalls(potentialWallPositions);

    // Actually place ramparts.
    for (const i in potentialWallPositions) {
      if (potentialWallPositions[i].isRelevant) {
        this.placementManager.planLocation(potentialWallPositions[i], 'rampart', null);
      }
    }

    return 'ok';
  }

  /**
   * Marks all walls which are adjacent to the "inner area" of the room.
   *
   * @param {RoomPosition[]} walls
   *   Positions where walls are currently planned.
   */
  pruneWalls(walls: RoomPosition[]) {
    const roomIntel = hivemind.roomIntel(this.roomName);
    const safety = roomIntel.calculateAdjacentRoomSafety();
    const roomCenter = _.first(this.roomPlan.getPositions('center'));
    this.safetyMatrix = new PathFinder.CostMatrix();

    const openList = [];
    openList.push(utilities.encodePosition(roomCenter));
    // @todo Include sources, minerals, controller.
    openList.push(utilities.encodePosition(roomIntel.getControllerPosition()));
    for (const source of roomIntel.getSourcePositions()) {
      openList.push(utilities.encodePosition(new RoomPosition(source.x, source.y, this.roomName)));
    }

    const mineral = roomIntel.getMineralPosition();
    openList.push(utilities.encodePosition(new RoomPosition(mineral.x, mineral.y, this.roomName)));

    this.pruneWallFromTiles(walls, openList);

    // Do a second pass, checking which walls get touched by unsafe exits.

    // Prepare CostMatrix and exit points.
    const exits = [];

    for (let i = 0; i < 50; i++) {
      if (this.terrain.get(0, i) !== TERRAIN_MASK_WALL && !safety.directions.W) {
        exits.push(utilities.encodePosition(new RoomPosition(0, i, this.roomName)));
      }

      if (this.terrain.get(49, i) !== TERRAIN_MASK_WALL && !safety.directions.E) {
        exits.push(utilities.encodePosition(new RoomPosition(49, i, this.roomName)));
      }

      if (this.terrain.get(i, 0) !== TERRAIN_MASK_WALL && !safety.directions.N) {
        exits.push(utilities.encodePosition(new RoomPosition(i, 0, this.roomName)));
      }

      if (this.terrain.get(i, 49) !== TERRAIN_MASK_WALL && !safety.directions.S) {
        exits.push(utilities.encodePosition(new RoomPosition(i, 49, this.roomName)));
      }
    }

    this.pruneWallFromTiles(walls, exits, true);

    // Safety matrix has been filled, now mark any tiles unsafe that can be reached by a ranged attacker.
    for (let x = 0; x < 50; x++) {
      for (let y = 0; y < 50; y++) {
        // Only check around unsafe tiles.
        if (this.safetyMatrix.get(x, y) !== 2) continue;

        this.markTilesInRangeOfUnsafeTile(x, y);
      }
    }
  };

  /**
   * Removes any walls that can not be reached from the given list of coordinates.
   *
   * @param {RoomPosition[]} walls
   *   Positions where walls are currently planned.
   * @param {string[]} startLocations
   *   Encoded positions from where to start flood filling.
   * @param {boolean} onlyRelevant
   *   Only check walls that have been declared as relevant in a previous pass.
   */
  pruneWallFromTiles(walls: RoomPosition[], startLocations: string[], onlyRelevant?: boolean) {
    const openList = {};
    const closedList = {};
    let safetyValue = 1;

    for (const location of startLocations) {
      openList[location] = true;
    }

    // If we're doing an additionall pass, unmark walls first.
    if (onlyRelevant) {
      safetyValue = 2;
      for (const wall of walls) {
        wall.isIrrelevant = true;
        if (wall.isRelevant) {
          wall.isIrrelevant = false;
          wall.isRelevant = false;
        }
      }
    }

    // Flood fill, marking all walls we touch as relevant.
    while (_.size(openList) > 0) {
      const nextPos = utilities.decodePosition(_.first(_.keys(openList)));

      // Record which tiles are safe or unsafe.
      this.safetyMatrix.set(nextPos.x, nextPos.y, safetyValue);

      delete openList[utilities.encodePosition(nextPos)];
      closedList[utilities.encodePosition(nextPos)] = true;

      this.checkForAdjacentWallsToPrune(nextPos, walls, openList, closedList);
    }
  };

  /**
   * Checks tiles adjacent to this one.
   * Marks ramparts as relevant and adds open positions to open list.
   *
   * @param {RoomPosition} targetPos
   *   The position to check around.
   * @param {RoomPosition[]} walls
   *   Positions where walls are currently planned.
   * @param {object} openList
   *   List of tiles to check, keyed by encoded tile position.
   * @param {object} closedList
   *   List of tiles that have been checked, keyed by encoded tile position.
   */
  checkForAdjacentWallsToPrune(targetPos: RoomPosition, walls: RoomPosition[], openList, closedList) {
    // Add unhandled adjacent tiles to open list.
    utilities.handleMapArea(targetPos.x, targetPos.y, (x, y) => {
      if (x === targetPos.x && y === targetPos.y) return;
      if (x < 1 || x > 48 || y < 1 || y > 48) return;

      // Ignore walls.
      if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) return;

      const posName = utilities.encodePosition(new RoomPosition(x, y, this.roomName));
      if (openList[posName] || closedList[posName]) return;

      // If there's a rampart to be built there, mark it and move on.
      let wallFound = false;
      for (const wall of walls) {
        if (wall.x !== x || wall.y !== y) continue;

        // Skip walls that might have been discarded in a previous pass.
        if (wall.isIrrelevant) continue;

        wall.isRelevant = true;
        wallFound = true;
        closedList[posName] = true;
        break;
      }

      if (!wallFound) {
        openList[posName] = true;
      }
    });
  };

  /**
   * Mark tiles that can be reached by ranged creeps outside our walls as unsafe.
   *
   * @param {number} x
   *   x position of the a tile that is unsafe.
   * @param {number} y
   *   y position of the a tile that is unsafe.
   */
  markTilesInRangeOfUnsafeTile(x: number, y: number) {
    utilities.handleMapArea(x, y, (ax, ay) => {
      if (this.safetyMatrix.get(ax, ay) === 1) {
        // Safe tile in range of an unsafe tile, mark as neutral.
        this.safetyMatrix.set(ax, ay, 0);
      }
    }, 3);
  };

  /**
   * Places towers so exits are well covered.
   */
  placeTowers(): StepResult {
    const costMatrixBackup: {
      [location: string]: number,
    } = {};
    const positions = this.findTowerPositions();
    const ramparts = this.findRampartPositions();
    while (this.canPlaceMore('tower')) {
      const newTowers = [];

      this.scoreRampartPositions(ramparts);
      this.scoreTowerPositions(positions, ramparts);
      while(newTowers.length < this.remainingStructureCount('tower')) {
        let info = _.max(positions, 'score');
        if (!info || typeof info === 'number' || info.score < 0) break;

        info.score = -1;

        // Make sure it's possible to refill this tower.
        const result = PathFinder.search(info.pos, this.roomCenterEntrances, {
          roomCallback: () => this.buildingMatrix,
          maxRooms: 1,
          plainCost: 1,
          swampCost: 1, // We don't care about cost, just about possibility.
        });
        if (result.incomplete) continue;

        // Add tentative tower location.
        newTowers.push(info.pos);
        costMatrixBackup[utilities.encodePosition(info.pos)] = this.buildingMatrix.get(info.pos.x, info.pos.y);
        this.placeFlag(info.pos, 'tower_placeholder');

        if (newTowers.length < this.remainingStructureCount('tower')) {
          this.scoreRampartPositions(ramparts);
          this.scoreTowerPositions(positions, ramparts);
        }
      }

      // Abort if no towers can be placed.
      if (newTowers.length === 0) break;

      // Also create roads to all towers.
      for (const pos of newTowers) {
        // Check if access is still possible.
        const result = PathFinder.search(pos, this.roomCenterEntrances, {
          roomCallback: () => this.buildingMatrix,
          maxRooms: 1,
          plainCost: 1,
          swampCost: 1, // We don't care about cost, just about possibility.
        });
        // @todo Decrement counter for tower direction.
        if (result.incomplete) continue;

        this.placeFlag(pos, 'tower');
        this.placeAccessRoad(pos);
      }

      // Restore building matrix values for subsequent operations.
      for (const pos of this.roomPlan.getPositions('tower_placeholder')) {
        if (this.roomPlan.hasPosition('tower', pos)) continue;

        this.buildingMatrix.set(pos.x, pos.y, costMatrixBackup[utilities.encodePosition(pos)]);
      }

      // Remove tower_placeholder markers for correct scoring during next iteration.
      this.roomPlan.removeAllPositions('tower_placeholder');
    }

    return 'ok';
  };

  /**
   * Finds all positions where we might place towers within rampart protection.
   *
   * @return {array}
   *   An array of objects with the following keys:
   *   - score: The tower score for this position.
   *   - pos: The position in question.
   */
  findTowerPositions(): ScoredTowerPosition[] {
    const roomIntel = hivemind.roomIntel(this.roomName);
    const safety = roomIntel.calculateAdjacentRoomSafety();
    const positions: ScoredTowerPosition[] = [];

    const allDirectionsSafe = _.sum(safety.directions) === 4;
    if (allDirectionsSafe) return positions;

    for (let x = 1; x < 49; x++) {
      for (let y = 1; y < 49; y++) {
        if (this.buildingMatrix.get(x, y) !== 0 && this.buildingMatrix.get(x, y) !== 10) continue;
        if (this.safetyMatrix.get(x, y) !== 1) continue;
        if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

        positions.push({
          score: 0,
          pos: new RoomPosition(x, y, this.roomName),
        });
      }
    }

    return positions;
  }

  /**
   * Scores all available tower positions based on rampart tiles in range.
   *
   * Unprotected ramparts get higher priority than those already protected
   * by another tower.
   */
  scoreTowerPositions(positions: ScoredTowerPosition[], rampartPositions: ScoredTowerPosition[]) {
    for (const info of positions) {
      // Skip positions already considered for tower or road placement.
      if (this.buildingMatrix.get(info.pos.x, info.pos.y) !== 0 && this.buildingMatrix.get(info.pos.x, info.pos.y) !== 10) info.score = -1;
      if (info.score < 0) continue;

      let score = 0;

      // Add score for ramparts in range.
      for (const rampart of rampartPositions) {
        score += rampart.score * this.getTowerEffectScore(rampart.pos, info.pos.x, info.pos.y);
      }

      info.score = score;
    }
  }

  /**
   * Finds the position of all ramparts in the room.
   */
  findRampartPositions(): ScoredTowerPosition[] {
    const positions = [];

    for (const pos of this.roomPlan.getPositions('rampart')) {
      positions.push({
        score: 1,
        pos,
      });
    }

    return positions;
  }

  /**
   * Calculates a weight for each rampart based on current protection level.
   *
   * The more towers in are in range of a rampart, the less important it is
   * to add more protection near it.
   */
  scoreRampartPositions(positions: ScoredTowerPosition[]) {
    for (const info of positions) {
      let rampartScore = 1;

      for (const pos of this.roomPlan.getPositions('tower')) {
        rampartScore *= 1 - 0.8 * this.getTowerEffectScore(pos, info.pos.x, info.pos.y);
      }
      for (const pos of this.roomPlan.getPositions('tower_placeholder')) {
        rampartScore *= 1 - 0.8 * this.getTowerEffectScore(pos, info.pos.x, info.pos.y);
      }

      info.score = rampartScore;
    }
  }

  /**
   * Determines tower efficiency by range.
   *
   * @return {number}
   *   Between 0 for least efficient and 1 for highest efficiency.
   */
  getTowerEffectScore(pos: RoomPosition, x: number, y: number): number {
    const effectiveRange = Math.min(Math.max(pos.getRangeTo(x, y) + 2, TOWER_OPTIMAL_RANGE), TOWER_FALLOFF_RANGE);
    return 1 - ((effectiveRange - TOWER_OPTIMAL_RANGE) / (TOWER_FALLOFF_RANGE - TOWER_OPTIMAL_RANGE));
  }

  /**
   * Places walls around spawns so creeps don't get spawned on inaccessible tiles.
   */
  placeSpawnWalls(): StepResult {
    for (const pos of this.roomPlan.getPositions('spawn')) {
      utilities.handleMapArea(pos.x, pos.y, (x, y) => {
        if (this.placementManager.isBuildableTile(x, y)) {
          // Check if any adjacent tile has a road, which means creeps can leave from there.
          let hasRoad = false;
          utilities.handleMapArea(x, y, (ax, ay) => {
            if (this.roomPlan.hasPosition('road', new RoomPosition(ax, ay, this.roomName)) && this.placementManager.isBuildableTile(ax, ay, true)) {
              hasRoad = true;
              return false;
            }

            return true;
          });
          if (hasRoad) return;

          // Place a wall to prevent spawning in this direction.
          this.placementManager.planLocation(new RoomPosition(x, y, pos.roomName), 'wall');
          this.placementManager.planLocation(new RoomPosition(x, y, pos.roomName), 'wall.blocker');
        }
      });
    }

    return 'ok';
  };

  isFinished(): boolean {
    return this.finished;
  }
}
