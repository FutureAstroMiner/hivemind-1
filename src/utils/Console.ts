import { getRoomIntel } from '../room-intel';
import hivemind from "../hivemind";

declare global {
    namespace NodeJS {
        interface Global {
            help: string,

            getSettings(): string,

            setSettingOn(key: string): string,

            setUILevel: (level: UIlevel) => string,
            // print: any,
            debugProcess: (n: number) => string,
            drawProcessTable: () => string,
            openRoomPlan: (roomName: string, ticks?: number | undefined) => string,
            replanRoom: (roomName: string) => string,
            removeFlagsByColor: (color: ColorConstant, secondaryColor?: ColorConstant | undefined) => string,
            deepCleanMemory: () => string,
            cancelMarketOrders: (filter?: ((order: Order) => any) | undefined) => string,
            setLogLevel: (level: number) => void,
            getDeposits: () => void,
            toggleProfiler: (str: string) => string
        }
    }

    enum UIlevel {
        NONE, MIN, MAX
    }
}

/**
 * Console registers a number of global methods for direct use in the Screeps console
 */
export class HivemindConsole {

    static init() {
        global.help = this.help();
        global.getSettings = this.getSettings;
        global.debugProcess = this.debugProcess;
        global.openRoomPlan = this.openRoomPlan;
        global.replanRoom = this.replanRoom;
        global.removeFlagsByColor = this.removeFlagsByColor;
        global.cancelMarketOrders = this.cancelMarketOrders;
        global.getDeposits = this.getDeposits;
    }

    // Help, information, and operational changes ======================================================================

    static help() {
        let msg = '\n<font color="#ff00ff">';
        // for (const line of asciiLogoSmall) {
        // 	msg += line + '\n';
        // }
        msg += '</font>';

        // Generate a methods description object
        const descr: { [functionName: string]: string } = {};
        descr.help = 'show this message';
        descr['getSettings()'] = 'Show current settings';
        descr['debugProcess(ticks?)'] = 'show processes run this tick for x ticks';
        descr['openRoomPlan(roomName, ticks?)'] = 'show room planner for x ticks';
        descr['replanRoom(roomName)'] = 'redo the room plan';
        descr['removeFlagsByColor(color, secondaryColor)'] = 'remove flags that match the specified colors';
        descr['cancelMarketOrders(filter?)'] = 'cancels all market orders matching filter (if provided)';
        descr['getDeposits()'] = 'Get deposits info';

        // Console list
        const descrMsg = toColumns(descr, {
            justify: true,
            padChar: '.'
        });
        const maxLineLength = _.max(_.map(descrMsg, line => line.length)) + 2;
        msg += _.padRight('Console Commands: ', maxLineLength, '=') + '\n' + descrMsg.join('\n');

        msg += '\n\nRefer to the repository for more information\n';

        return msg;
    }

    static getSettings(): string {
        return JSON.stringify(hivemind.settings.values);
    }

    // Debugging methods ===============================================================================================
    static debugProcess(numTicks = 20) {
        Memory.hivemind.showProcessDebug = numTicks;
        return 'Showing process debug for ' + numTicks;
    }

    // Room planner control ============================================================================================

    static openRoomPlan(roomName: string, ticks?: number) {
        const room = Game.rooms[roomName];
        if (room) {
            room.roomPlanner.viewRoomPlan(ticks);
            return 'RoomPlanner opened for ' + roomName;
        }
        return 'Unknown room ' + roomName;
    }

    static replanRoom(roomName: string) {
        const room = Game.rooms[roomName];
        if (room) {
            room.roomPlanner.startRoomPlanGeneration();
            return 'Replanning room plan for ' + roomName;
        }
        return 'Unknown room ' + roomName;
    }

    // Flag management ============================================================================================

    static removeFlagsByColor(color: ColorConstant, secondaryColor?: ColorConstant): string {
        const removeFlags = _.filter(Game.flags, flag => {
            if (secondaryColor) {
                return flag.color == color && flag.secondaryColor == secondaryColor;
            } else {
                return flag.color == color;
            }
        });
        for (const flag of removeFlags) {
            flag.remove();
        }
        return `Removed ${removeFlags.length} flags.`;
    }

    // Misc management ===============================================================================================

    static cancelMarketOrders(filter?: (order: Order) => any): string {
        const ordersToCancel = !!filter ? _.filter(Game.market.orders, order => filter(order)) : Game.market.orders;
        _.forEach(_.values(ordersToCancel), (order: Order) => Game.market.cancelOrder(order.id));
        return `Canceled ${_.values(ordersToCancel).length} orders.`;
    }

    static getDeposits() {
        if (!Memory.strategy.deposits) return;
        Object.keys(Memory.strategy.deposits.rooms).forEach(roomName => {
            const depositInfo = getRoomIntel(roomName).getDepositInfo();
            if (depositInfo.length > 0) hivemind.log('strategy', roomName).info(JSON.stringify(depositInfo));
        });
    }
}

interface ToColumnOpts {
    padChar: string;
    justify: boolean;
}

/**
 * Create column-aligned text array from object with string key/values
 */
export function toColumns(obj: { [key: string]: string }, opts = {} as ToColumnOpts): string[] {
    _.defaults(opts, {
        padChar: ' ',	// Character to pad with, e.g. "." would be key........val
        justify: false 	// Right align values column?
    });

    const ret: string[] = [];
    const keyPadding = _.max(_.map(_.keys(obj), str => str.length)) + 1;
    const valPadding = _.max(_.mapValues(obj, str => str.length));

    for (const key in obj) {
        if (opts.justify) {
            ret.push(_.padRight(key, keyPadding, opts.padChar) + _.padLeft(obj[key], valPadding, opts.padChar));
        } else {
            ret.push(_.padRight(key, keyPadding, opts.padChar) + obj[key]);
        }
    }
    return ret;
}
